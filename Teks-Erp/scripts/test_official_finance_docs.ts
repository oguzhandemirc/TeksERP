// =============================================================================
// BEKÇİ — RESMİ ÖN MUHASEBE BELGELERİ (mutabakat mektubu + çek teslim bordrosu)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_official_finance_docs.ts
//
// NEDEN: İkisi de KARŞI TARAFA giden resmi kâğıttır ve ikisinin de en tehlikeli
// arıza biçimi SESSİZDİR:
//   • Mutabakat mektubu YANLIŞ BİR ANIN bakiyesini basarsa (asOf süzgeci
//     düşerse) kâğıt "31 Temmuz itibarıyla" der ama bugünün rakamını taşır —
//     hata yok, log yok, yalnız karşı tarafla anlaşamayan iki defter.
//   • Bordro çekin DURUMUNU oynatırsa aynı fiziksel olay iki yoldan
//     tetiklenebilir hale gelir ve portföy sessizce yalan söyler.
//
// ÖLÇÜLENLER:
//   §1 ⭐ Mutabakat bakiyesi DEFTERDEN birebir + `asOf` SONRASI hareket DIŞARIDA
//        + sıfır bakiyeli ama HAREKETLİ para birimi SATIR olarak durur
//   §2 ⭐ Belge OLUŞTURMADA dondu (v1 ACTIVE) ve snapshot bakiyeyi TAŞIYOR
//   §3 İptal → belge VOIDED (kayıt SİLİNMEZ) + ikinci iptal 409
//   §4 ⭐ Bordro: pivot satırları + donmuş belgede çeklerin docNo'ları
//   §5 ⭐ Bordro ÇEKİN DURUMUNA DOKUNMADI (ve olay defterine satır yazmadı) — bayrak
//        `finance.chequeNoteMovementEnabled` KAPALI kolu (açıkça yazılır, geri yüklenir);
//        AÇIK kolu (hareket fişi, K3) `test_cek_bordro_hareket`
//   §6 Belge numaraları MBT/BRD + GGAAYY + NNNN biçiminde
//   §7 MEKANİK HİZA: DOC_PERMISSIONS (read ⊇ write) · DOC_CONFIG_KEYS (var +
//      BENZERSİZ) · builder kaydı + renderHtml · örnek veri (panel önizlemesi)
//   §8 H6 kuralları FAIL-CLOSED: boş seçim · karışık yön · iptal edilmiş çek ·
//      çift hedef
//   §9 ⭐ BORDRO SATIR SIRASI DETERMİNİSTİK — kâğıt, ekran ve REVİZYON aynı sırayı
//        basar (pivotun `createdAt`i tüm satırlarda AYNI olduğu için sıralamaz)
//   §10 ⭐ "Zaten AKTİF bir bordroda" ONAYLATMASI — 409 + `confirmDuplicate` ile
//        geçilir; İPTAL edilmiş bordro engellemez
//   §11 ⭐ `asOf` GÜN SINIRI SINIR KATMANINDA çözülür (gün-yalnız değer o günün
//        SONU) — istemcinin doğru göndermesine güvenilmez
//   §12 ⭐ Mektup DÖNEM MÜHRÜNDEN OKUMAZ (bilinçli karar; kasıtlı YANLIŞ mühürle
//        ölçülür) ve satır aritmetiği kendi içinde tutar
//   körlük zemini: her bölümde "hiçbir şeye bakılmadı" ile "ihlal yok" ayrılır
//
// NEGATİF SONDA (yazılırken ölçüldü, rapor gövdesinde):
//   (a) `deriveCariBalancesAsOf`un `txnDate <= asOf` süzgeci kaldırılınca §1 KIRMIZI
//   (b) `reconciliation-letter.service`teki `freezeForSource` çağrısı kaldırılınca §2 KIRMIZI
//   (c) `ITEM_ORDER` → `{ createdAt: "asc" }` (2026-08-15 öncesi hâli) → §9 KIRMIZI
//   (d) `assertNotAlreadyDelivered` çağrısı kaldırılınca → §10 KIRMIZI
//   (e) rota `endBoundary(b.asOf)` yerine `new Date(b.asOf)` yazınca → §11 KIRMIZI
// =============================================================================
import {
  CariKind,
  CariTxnSource,
  ChequeDeliveryNoteStatus,
  ChequeDocType,
  ChequeKind,
  ChequeStatus,
  Currency,
  PrintedDocStatus,
  PrintedDocType,
  ReconciliationLetterStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  printedDocumentService,
  getRegisteredDocBuilders,
  DOC_CONFIG_KEYS,
} from "../src/services/printed-document.service";
import { DOC_PERMISSIONS } from "../src/routes/printed-document.routes";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import {
  reconciliationLetterService,
  deriveCariBalancesAsOf,
} from "../src/services/reconciliation-letter.service";
import {
  ALREADY_IN_ACTIVE_NOTE,
  chequeDeliveryNoteService,
} from "../src/services/cheque-delivery-note.service";
import { factoryDayEnd, factoryDayKeyUtcMidnight, factoryYmd, resolveRangeEnd } from "../src/constants/time";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Hata bekleyen çağrı — mesajı döner, hata ATILMAZSA `null`. */
async function expectReject(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const TAG = `TEST-OFD-${Date.now()}`;
const DAY = 86_400_000;

// Cleanup tutucuları — FK sırası: pivot → belge → printedDocument → cheque →
// cariTransaction → cariBalance → cariAccount → customer.
let customerId: string | null = null;
let cariId: string | null = null;
let bankAccountId: string | null = null;
const letterIds: string[] = [];
const noteIds: string[] = [];
const chequeIds: string[] = [];

const docsOf = (sourceId: string, docType: PrintedDocType) =>
  prisma.printedDocument.findMany({
    where: { docType, sourceId },
    select: { id: true, version: true, status: true, snapshot: true },
    orderBy: { version: "asc" },
  });

interface SnapBalance {
  currency: string;
  debit: string;
  credit: string;
  balance: string;
}

// Bayrak yalnız modül açıkken etkindir (`finance && bayrak`): kapalı kolu ölçmek için modül AÇIK, bayrak KAPALI.
const PINNED: ReadonlyArray<[string, boolean]> = [["finance.enabled", true], ["finance.chequeNoteMovementEnabled", false]];
const ayarYedek = new Map<string, { value: unknown } | null>();

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n❌ ${engel}\n`);
    fail++;
    return;
  }
  console.log("=== Resmi ön muhasebe belgeleri bekçisi ===\n");
  // §5 belge-only kolu ölçer: bordro hareket fişi bayrağı açıkça KAPALI (bugünkü davranış).
  for (const [key, value] of PINNED) {
    ayarYedek.set(key, await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } }));
    await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  const actor = await prisma.user.findFirstOrThrow({
    where: { isActive: true },
    select: { id: true },
  });

  const customer = await prisma.customer.create({
    data: { code: TAG, name: `${TAG} Müşteri` },
    select: { id: true },
  });
  customerId = customer.id;

  const cari = await prisma.cariAccount.create({
    data: { kind: CariKind.CUSTOMER, customerId: customer.id },
    select: { id: true },
  });
  cariId = cari.id;

  // ── FİXTÜR: İKİ PARA BİRİMLİ DEFTER, KESİT ORTADA ───────────────────────
  // asOf = ŞİMDİ. Kesitin SONRASINA bilerek büyük bir hareket yazılır; süzgeç
  // düşerse bakiye o rakamla şişer ve §1 kırmızı verir (negatif sonda (a)).
  const asOf = new Date();
  const txn = (
    currency: Currency,
    dayOffset: number,
    debit: number,
    credit: number,
  ) =>
    prisma.cariTransaction.create({
      data: {
        cariId: cari.id,
        currency,
        txnDate: new Date(asOf.getTime() + dayOffset * DAY),
        debit,
        credit,
        amountTry: debit || credit,
        exchangeRate: 1,
        sourceType: CariTxnSource.ADJUSTMENT,
        description: `${TAG} fikstür`,
        createdById: actor.id,
      },
      select: { id: true },
    });

  await txn(Currency.TRY, -10, 1000, 0);
  await txn(Currency.TRY, -5, 0, 400);
  // ⚠️ KESİT SONRASI — mutabakata GİRMEMELİ.
  await txn(Currency.TRY, +5, 9999, 0);
  // Sıfır bakiyeli ama HAREKETLİ para birimi: satır olarak DURMALI.
  await txn(Currency.USD, -8, 500, 0);
  await txn(Currency.USD, -2, 0, 500);
  // EUR hiç hareket görmez → satırı OLMAMALI.

  // ── §1 BAKİYE DEFTERDEN BİREBİR ─────────────────────────────────────────
  const derived = await deriveCariBalancesAsOf(prisma, cari.id, asOf);
  const byCur = new Map(derived.map((r) => [r.currency, r]));

  check("§1z KÖRLÜK ZEMİNİ: fikstür defteri kuruldu", derived.length >= 2, `${derived.length} para birimi`);
  check(
    "§1a ⭐ TRY bakiyesi defterle BİREBİR (1000 − 400 = 600)",
    byCur.get(Currency.TRY)?.balance.toString() === "600",
    `balance=${byCur.get(Currency.TRY)?.balance.toString()}`,
  );
  check(
    "§1b TRY borç/alacak toplamları ayrı ayrı doğru",
    byCur.get(Currency.TRY)?.debit.toString() === "1000" &&
      byCur.get(Currency.TRY)?.credit.toString() === "400",
    `debit=${byCur.get(Currency.TRY)?.debit.toString()} credit=${byCur.get(Currency.TRY)?.credit.toString()}`,
  );
  check(
    "§1c ⭐ `asOf` SONRASI hareket DIŞARIDA (9999 sızmadı)",
    byCur.get(Currency.TRY)?.debit.toString() === "1000",
  );
  check(
    "§1d ⭐ SIFIR bakiyeli ama HAREKETLİ para birimi SATIR olarak durur",
    byCur.get(Currency.USD)?.balance.toString() === "0" &&
      byCur.get(Currency.USD)?.debit.toString() === "500",
    `USD balance=${byCur.get(Currency.USD)?.balance.toString()}`,
  );
  check("§1e Hareketi OLMAYAN para birimi satır DOĞURMAZ", !byCur.has(Currency.EUR));
  check(
    "§1f Sıra deterministik (Currency beyan sırası: TRY → USD)",
    derived[0]?.currency === Currency.TRY && derived[1]?.currency === Currency.USD,
    derived.map((r) => r.currency).join(","),
  );

  // Kesit SONRASINA alınan bir mektup 9999'u DE görmeli (süzgecin gerçekten
  // tarihe göre çalıştığının pozitif kanıtı — sabit bir "hep 1000" değil).
  const later = await deriveCariBalancesAsOf(prisma, cari.id, new Date(asOf.getTime() + 10 * DAY));
  check(
    "§1g Kesit ileri alınınca sonraki hareket DAHİL olur (süzgeç gerçekten tarih bazlı)",
    later.find((r) => r.currency === Currency.TRY)?.balance.toString() === "10599",
    `balance=${later.find((r) => r.currency === Currency.TRY)?.balance.toString()}`,
  );

  // ── §2 BELGE OLUŞTURMADA DONAR ──────────────────────────────────────────
  const created = await reconciliationLetterService.create(
    { cariId: cari.id, asOf, notes: `${TAG} mutabakat` },
    actor.id,
  );
  const letterId = (created.data as { id: string }).id;
  const letterNo = (created.data as { docNo: string }).docNo;
  letterIds.push(letterId);

  const letterDocs = await docsOf(letterId, PrintedDocType.RECONCILIATION_LETTER);
  check("§2a ⭐ OLUŞTURMADA belge DONDU", letterDocs.length === 1, `n=${letterDocs.length}`);
  check(
    "§2b Versiyon 1 ve AKTİF",
    letterDocs[0]?.version === 1 && letterDocs[0]?.status === PrintedDocStatus.ACTIVE,
    `v=${letterDocs[0]?.version} status=${letterDocs[0]?.status}`,
  );

  const snap = letterDocs[0]?.snapshot as { doc?: { balances?: SnapBalance[]; header?: Record<string, unknown> } } | null;
  const snapBalances = snap?.doc?.balances ?? [];
  check(
    "§2c ⭐ Snapshot bakiyeyi TAŞIYOR (TRY 600, defterle birebir)",
    snapBalances.find((b) => b.currency === "TRY")?.balance === "600",
    `snapshot=${snapBalances.find((b) => b.currency === "TRY")?.balance}`,
  );
  check(
    "§2d Snapshot sıfır bakiyeli para birimini de taşır",
    snapBalances.some((b) => b.currency === "USD" && b.balance === "0"),
    `n=${snapBalances.length}`,
  );
  check(
    "§2e Snapshot `asOf` ile `date`i AYRI taşır (kesit ≠ düzenleme)",
    typeof snap?.doc?.header?.asOf === "string" && typeof snap?.doc?.header?.date === "string",
  );

  const letterHtml =
    (await printedDocumentService.getHtml(PrintedDocType.RECONCILIATION_LETTER, letterId)).data
      ?.html ?? "";
  check("§2f Mektup HTML'i üretildi", letterHtml.includes("<html"), `${letterHtml.length} bayt`);
  check("§2g ⭐ Bakiye KÂĞIDA basıldı (tr-TR: 600,00)", letterHtml.includes("600,00"));
  check(
    "§2h Beyan (mutabakat ricası) kâğıtta",
    letterHtml.includes("mutabakat") || letterHtml.includes("Mutabık"),
  );

  // ── §3 İPTAL ────────────────────────────────────────────────────────────
  await reconciliationLetterService.cancel(letterId, `${TAG} deneme iptali`, actor.id);
  const letterAfter = await docsOf(letterId, PrintedDocType.RECONCILIATION_LETTER);
  check("§3a Belge SİLİNMEDİ (donmuş belge kuralı)", letterAfter.length === 1);
  check(
    "§3b ⭐ Belge VOIDED'a çekildi",
    letterAfter[0]?.status === PrintedDocStatus.VOIDED,
    `status=${letterAfter[0]?.status}`,
  );
  const letterRow = await prisma.reconciliationLetter.findUniqueOrThrow({
    where: { id: letterId },
    select: { status: true, cancelledAt: true, cancelReason: true },
  });
  check(
    "§3c Kayıt CANCELLED + sebep/damga yazıldı",
    letterRow.status === ReconciliationLetterStatus.CANCELLED &&
      letterRow.cancelledAt !== null &&
      (letterRow.cancelReason ?? "").includes(TAG),
  );
  const secondCancel = await expectReject(() =>
    reconciliationLetterService.cancel(letterId, "ikinci", actor.id),
  );
  check(
    "§3d İkinci iptal ATOMİK CLAIM ile reddedilir (409)",
    (secondCancel ?? "").includes("zaten iptal"),
    secondCancel ?? "hata ATILMADI",
  );

  // ── §4 BORDRO ───────────────────────────────────────────────────────────
  const bank = await prisma.bankAccount.create({
    data: { code: `${TAG}-BNK`, name: `${TAG} Banka`, currency: Currency.TRY },
    select: { id: true },
  });
  bankAccountId = bank.id;

  // ⚠️ Çekler DOĞRUDAN prisma ile kurulur (servis üzerinden DEĞİL): `chequeService
  // .create` cari deftere satır yazar ve §1'in fikstür bakiyesini sessizce
  // değiştirirdi. Bu bekçinin konusu BELGE katmanıdır, çek doğuşu değil.
  const mkCheque = async (
    kind: ChequeKind,
    amount: number,
    currency: Currency,
    status: ChequeStatus,
    suffix: string,
    /** Vade ofseti (gün) — §9 satır sırası bölümü bunu bilerek karıştırır. */
    dueDays = 30,
  ) => {
    const c = await prisma.cheque.create({
      data: {
        docNo: `${TAG}-${suffix}`.slice(0, 32),
        kind,
        docType: ChequeDocType.CHEQUE,
        status,
        cariId: cari.id,
        currency,
        exchangeRate: 1,
        amount,
        amountTry: amount,
        issueDate: new Date(asOf.getTime() - 3 * DAY),
        postingDate: new Date(asOf.getTime() - 3 * DAY),
        dueDate: new Date(asOf.getTime() + dueDays * DAY),
        serialNo: `SR-${suffix}`,
        bankName: "Test Bankası",
        drawerName: `${TAG} Keşideci`,
      },
      select: { id: true, docNo: true, status: true },
    });
    chequeIds.push(c.id);
    return c;
  };

  const c1 = await mkCheque(ChequeKind.RECEIVED, 1500, Currency.TRY, ChequeStatus.PORTFOLIO, "C1");
  const c2 = await mkCheque(ChequeKind.RECEIVED, 2500.5, Currency.TRY, ChequeStatus.AT_BANK, "C2");
  const c3 = await mkCheque(ChequeKind.RECEIVED, 300, Currency.USD, ChequeStatus.PORTFOLIO, "C3");
  const cIssued = await mkCheque(ChequeKind.ISSUED, 900, Currency.TRY, ChequeStatus.ISSUED, "C4");
  const cCancelled = await mkCheque(
    ChequeKind.RECEIVED,
    100,
    Currency.TRY,
    ChequeStatus.CANCELLED,
    "C5",
  );

  const noteRes = await chequeDeliveryNoteService.create(
    {
      chequeIds: [c1.id, c2.id, c3.id],
      bankAccountId: bank.id,
      targetLabel: "Kadıköy Şubesi",
      notes: `${TAG} bordro`,
    },
    actor.id,
  );
  const noteId = (noteRes.data as { id: string }).id;
  const noteNo = (noteRes.data as { docNo: string }).docNo;
  noteIds.push(noteId);

  const items = await prisma.chequeDeliveryNoteItem.findMany({
    where: { noteId },
    select: { chequeId: true },
  });
  check("§4a Pivot satırları yazıldı", items.length === 3, `n=${items.length}`);
  check(
    "§4b Pivot TAM OLARAK seçilen çekleri taşır",
    new Set(items.map((i) => i.chequeId)).size === 3 &&
      [c1.id, c2.id, c3.id].every((id) => items.some((i) => i.chequeId === id)),
  );

  const noteDocs = await docsOf(noteId, PrintedDocType.CHEQUE_DELIVERY_NOTE);
  check("§4c ⭐ Bordro belgesi OLUŞTURMADA dondu", noteDocs.length === 1, `n=${noteDocs.length}`);
  check(
    "§4d Versiyon 1 ve AKTİF",
    noteDocs[0]?.version === 1 && noteDocs[0]?.status === PrintedDocStatus.ACTIVE,
  );

  const noteSnap = noteDocs[0]?.snapshot as {
    doc?: {
      lines?: Array<{ docNo: string; amount: string; currency: string }>;
      totals?: Array<{ currency: string; count: number; amount: string }>;
      header?: { kind?: string };
    };
  } | null;
  const snapDocNos = (noteSnap?.doc?.lines ?? []).map((l) => l.docNo);
  check(
    "§4e ⭐ Donmuş listede çeklerin docNo'ları var",
    [c1.docNo, c2.docNo, c3.docNo].every((d) => snapDocNos.includes(d)),
    snapDocNos.join(","),
  );
  const totals = noteSnap?.doc?.totals ?? [];
  check(
    "§4f Para birimi bazlı ara toplam DOĞRU (TRY 2 adet / 4000.5)",
    totals.find((t) => t.currency === "TRY")?.count === 2 &&
      totals.find((t) => t.currency === "TRY")?.amount === "4000.5",
    JSON.stringify(totals),
  );
  check(
    "§4g Karışık para biriminde ara toplam AYRI satırlarda (TOPLANMAZ)",
    totals.length === 2 && totals.some((t) => t.currency === "USD"),
    `${totals.length} kova`,
  );
  check("§4h Bordronun yönü satırlardan çözüldü", noteSnap?.doc?.header?.kind === "RECEIVED");

  const noteHtml =
    (await printedDocumentService.getHtml(PrintedDocType.CHEQUE_DELIVERY_NOTE, noteId)).data
      ?.html ?? "";
  check("§4i Bordro HTML'i üretildi", noteHtml.includes("<html"), `${noteHtml.length} bayt`);
  check("§4j ⭐ Çek belge no'ları KÂĞIDA basıldı", noteHtml.includes(c1.docNo));
  check("§4k Hedef (banka + serbest metin) kâğıtta", noteHtml.includes("Kadıköy Şubesi"));

  // ── §5 ÇEKİN DURUMU DEĞİŞMEDİ ───────────────────────────────────────────
  const afterStatuses = await prisma.cheque.findMany({
    where: { id: { in: [c1.id, c2.id, c3.id] } },
    select: { id: true, status: true },
  });
  const statusOf = new Map(afterStatuses.map((c) => [c.id, c.status]));
  check(
    "§5a ⭐ Bordro çekin DURUMUNA DOKUNMADI (v1 belge-only)",
    statusOf.get(c1.id) === ChequeStatus.PORTFOLIO &&
      statusOf.get(c2.id) === ChequeStatus.AT_BANK &&
      statusOf.get(c3.id) === ChequeStatus.PORTFOLIO,
    [...statusOf.values()].join(","),
  );
  const events = await prisma.chequeEvent.count({ where: { chequeId: { in: [c1.id, c2.id, c3.id] } } });
  check("§5b Olay defterine satır YAZILMADI", events === 0, `${events} olay`);
  const ledgerAfter = await deriveCariBalancesAsOf(prisma, cari.id, asOf);
  check(
    "§5c ⭐ Cari defter OYNAMADI (bordro + mektup defter yazmaz)",
    ledgerAfter.find((r) => r.currency === Currency.TRY)?.balance.toString() === "600",
    `balance=${ledgerAfter.find((r) => r.currency === Currency.TRY)?.balance.toString()}`,
  );

  // Bordro iptali: belge VOIDED, pivot KALIR, çek durumu yine değişmez.
  await chequeDeliveryNoteService.cancel(noteId, `${TAG} bordro iptali`, actor.id);
  const noteAfter = await docsOf(noteId, PrintedDocType.CHEQUE_DELIVERY_NOTE);
  check("§5d İptalde belge VOIDED", noteAfter[0]?.status === PrintedDocStatus.VOIDED);
  const itemsAfter = await prisma.chequeDeliveryNoteItem.count({ where: { noteId } });
  check("§5e İptalde pivot satırları KALIR (hangi çekler bu bordrodaydı)", itemsAfter === 3);
  const noteRow = await prisma.chequeDeliveryNote.findUniqueOrThrow({
    where: { id: noteId },
    select: { status: true },
  });
  check("§5f Kayıt CANCELLED", noteRow.status === ChequeDeliveryNoteStatus.CANCELLED);
  const statusAfterCancel = await prisma.cheque.findUniqueOrThrow({
    where: { id: c1.id },
    select: { status: true },
  });
  check("§5g İptalde de çek durumu DEĞİŞMEZ", statusAfterCancel.status === ChequeStatus.PORTFOLIO);

  // ── §6 BELGE NUMARASI BİÇİMİ ────────────────────────────────────────────
  check("§6a Mutabakat no MBT+GGAAYY+NNNN", /^MBT\d{6}\d{4}$/.test(letterNo), letterNo);
  check("§6b Bordro no BRD+GGAAYY+NNNN", /^BRD\d{6}\d{4}$/.test(noteNo), noteNo);
  // İkinci belge sıradaki numarayı almalı (günlük sayaç çalışıyor mu).
  const second = await reconciliationLetterService.create({ cariId: cari.id, asOf }, actor.id);
  const secondNo = (second.data as { docNo: string }).docNo;
  letterIds.push((second.data as { id: string }).id);
  check(
    "§6c Günlük sayaç ilerliyor (aynı gün ikinci mektup farklı no)",
    secondNo !== letterNo && /^MBT\d{10}$/.test(secondNo),
    `${letterNo} → ${secondNo}`,
  );

  // ── §7 MEKANİK HİZA ─────────────────────────────────────────────────────
  const NEW_TYPES = [
    PrintedDocType.RECONCILIATION_LETTER,
    PrintedDocType.CHEQUE_DELIVERY_NOTE,
  ] as const;
  const registry = getRegisteredDocBuilders();

  for (const dt of NEW_TYPES) {
    const entry = DOC_PERMISSIONS[dt];
    check(`§7a ${dt} DOC_PERMISSIONS'ta tanımlı`, Boolean(entry?.read?.length && entry?.write?.length));
    check(
      `§7b ${dt} read ⊇ write (görüp basamama kapanı yok)`,
      (entry?.write ?? []).every((w) => (entry?.read ?? []).includes(w)),
      `read=${entry?.read?.join(",")} write=${entry?.write?.join(",")}`,
    );
    check(`§7c ${dt} DOC_CONFIG_KEYS'te anahtarı var`, Boolean(DOC_CONFIG_KEYS[dt]), DOC_CONFIG_KEYS[dt]);
    check(`§7d ${dt} builder KAYITLI`, registry.has(dt));
    check(`§7e ${dt} renderHtml TANIMLI`, Boolean(registry.get(dt)?.renderHtml));
    check(`§7f ${dt} örnek verisi VAR (panel önizlemesi)`, Boolean(SAMPLE_PRINTED_DOCS[dt]));
    const sampleHtml = await printedDocumentService.renderSampleHtml(dt, null);
    check(`§7g ${dt} örnek önizleme HTML üretiyor`, sampleHtml.includes("<html"), `${sampleHtml.length} bayt`);
  }

  // ⚠️ ANAHTARLAR BENZERSİZ: iki belge tipi aynı ayar anahtarını paylaşırsa
  // birinin şablonu diğerinin baskısını da değiştirir ve hiçbir yerde hata çıkmaz.
  const cfgValues = Object.values(DOC_CONFIG_KEYS);
  check(
    "§7h DOC_CONFIG_KEYS değerleri BENZERSİZ",
    new Set(cfgValues).size === cfgValues.length,
    `${cfgValues.length} tip`,
  );
  // ⚠️ KÖRLÜK ZEMİNİ yalnız ENUM/ROUTE tabanlı haritalara bakar. `registry.size`
  // BİLEREK dışarıda: bu dosya YALNIZ kendi iki servisini import eder (registry
  // import yan etkisiyle dolar), çünkü tüm belge dünyasını import etmek bu
  // bekçinin BAŞKASININ hatasıyla kırmızıya dönmesi demekti. Registry tamlığı
  // `scripts/test_printed_doc_builders.ts`in işidir; buradaki karşılığı
  // §7d/§7e'dir (kendi iki builder'ımızın kaydı gerçekten koştu mu).
  check(
    "§7z KÖRLÜK ZEMİNİ: enum tabanlı haritalar dolu",
    Object.keys(DOC_PERMISSIONS).length >= 13 && cfgValues.length >= 13,
    `perm=${Object.keys(DOC_PERMISSIONS).length} cfg=${cfgValues.length} (builder=${registry.size}, bu dosya 2 servis import eder)`,
  );

  // ── §8 H6 KURALLARI FAIL-CLOSED ─────────────────────────────────────────
  const emptyMsg = await expectReject(() => chequeDeliveryNoteService.create({ chequeIds: [] }, actor.id));
  check("§8a Boş seçim REDDEDİLİR", (emptyMsg ?? "").includes("en az bir"), emptyMsg ?? "hata ATILMADI");

  const mixedMsg = await expectReject(() =>
    chequeDeliveryNoteService.create({ chequeIds: [c1.id, cIssued.id] }, actor.id),
  );
  check(
    "§8b ⭐ KARIŞIK YÖN reddedilir (bir bordro TEK yön taşır)",
    (mixedMsg ?? "").includes("TEK YÖN"),
    mixedMsg ?? "hata ATILMADI",
  );

  const cancelledMsg = await expectReject(() =>
    chequeDeliveryNoteService.create({ chequeIds: [c1.id, cCancelled.id] }, actor.id),
  );
  check(
    "§8c ⭐ İPTAL EDİLMİŞ çek bordroya giremez",
    (cancelledMsg ?? "").includes("iptal edilmiş"),
    cancelledMsg ?? "hata ATILMADI",
  );

  const doubleTargetMsg = await expectReject(() =>
    chequeDeliveryNoteService.create(
      { chequeIds: [c1.id], bankAccountId: bank.id, cariId: cari.id },
      actor.id,
    ),
  );
  check(
    "§8d Çift yapılandırılmış hedef reddedilir",
    (doubleTargetMsg ?? "").includes("ikisi birden"),
    doubleTargetMsg ?? "hata ATILMADI",
  );

  const missingMsg = await expectReject(() =>
    chequeDeliveryNoteService.create(
      { chequeIds: [c1.id, "00000000-0000-4000-8000-000000000000"] },
      actor.id,
    ),
  );
  check(
    "§8e Bulunamayan çek reddedilir (sessizce atlanmaz)",
    (missingMsg ?? "").includes("bulunamadı"),
    missingMsg ?? "hata ATILMADI",
  );

  // Mükerrer id → sessizce tekilleştirilir (pivot @@unique'e ham P2002 ile çarpmaz).
  const dupRes = await chequeDeliveryNoteService.create({ chequeIds: [c1.id, c1.id] }, actor.id);
  const dupNoteId = (dupRes.data as { id: string }).id;
  noteIds.push(dupNoteId);
  const dupItems = await prisma.chequeDeliveryNoteItem.count({ where: { noteId: dupNoteId } });
  check("§8f Mükerrer çek id'si TEKİLLEŞTİRİLİR", dupItems === 1, `${dupItems} satır`);

  // Pasif cariye mutabakat kesilmez (yol açık: önce aktifleştir).
  await prisma.cariAccount.update({ where: { id: cari.id }, data: { isActive: false } });
  const passiveMsg = await expectReject(() =>
    reconciliationLetterService.create({ cariId: cari.id }, actor.id),
  );
  check(
    "§8g Pasif cariye mutabakat kesilmez (yol gösterilir)",
    (passiveMsg ?? "").includes("pasif"),
    passiveMsg ?? "hata ATILMADI",
  );
  await prisma.cariAccount.update({ where: { id: cari.id }, data: { isActive: true } });

  // ── §9 BORDRO SATIR SIRASI DETERMİNİSTİK ────────────────────────────────
  // NEDEN VAR: pivotun `createdAt`i tek `createMany` + tek tx yüzünden TÜM
  // satırlarda BİREBİR AYNIDIR (aşağıda ölçülüyor). Eski `orderBy: { createdAt }`
  // bu yüzden hiçbir şey sıralamıyordu: sıra plana kalıyordu ve v1 ile `reissue`
  // v2 aynı içerik için FARKLI "SIRA" numaraları basabiliyordu — karşı taraf
  // imzalanmış kâğıtla ekranı karşılaştırdığında sebepsiz bir fark görürdü.
  const o1 = await mkCheque(ChequeKind.RECEIVED, 10, Currency.TRY, ChequeStatus.PORTFOLIO, "O1", 40);
  const o2 = await mkCheque(ChequeKind.RECEIVED, 20, Currency.TRY, ChequeStatus.PORTFOLIO, "O2", 5);
  const o3 = await mkCheque(ChequeKind.RECEIVED, 30, Currency.TRY, ChequeStatus.PORTFOLIO, "O3", 25);
  // Yazılma sırası O1→O2→O3, VADE sırası O2→O3→O1: ikisi bilerek AYRI, yoksa
  // kontrol "hangi kural uygulandı" sorusunu ayırt edemez ve vakumen yeşil kalır.
  const ordRes = await chequeDeliveryNoteService.create(
    { chequeIds: [o1.id, o2.id, o3.id], targetLabel: "Sıra denemesi" },
    actor.id,
  );
  const ordId = (ordRes.data as { id: string }).id;
  noteIds.push(ordId);

  const stampRows = await prisma.$queryRaw<Array<{ n: bigint; d: bigint }>>`
    SELECT count(*)::bigint AS n, count(DISTINCT "createdAt")::bigint AS d
    FROM cheque_delivery_note_items WHERE "noteId" = ${ordId}::uuid`;
  check(
    "§9z KÖRLÜK ZEMİNİ: pivot `createdAt` TÜM satırlarda AYNI (kuralın var oluş sebebi)",
    Number(stampRows[0]?.n ?? 0) === 3 && Number(stampRows[0]?.d ?? 0) === 1,
    `n=${stampRows[0]?.n} farklı damga=${stampRows[0]?.d}`,
  );

  const EXPECTED_ORDER = [o2.docNo, o3.docNo, o1.docNo];
  const linesOf = async (id: string, version?: number): Promise<string[]> => {
    const docs = await docsOf(id, PrintedDocType.CHEQUE_DELIVERY_NOTE);
    const doc = version ? docs.find((d) => d.version === version) : docs[docs.length - 1];
    const s = doc?.snapshot as { doc?: { lines?: Array<{ docNo: string }> } } | null;
    return (s?.doc?.lines ?? []).map((l) => l.docNo);
  };
  const v1Lines = await linesOf(ordId, 1);
  check(
    "§9a ⭐ Donmuş belgede satırlar VADE sırasında (yazılma sırasında DEĞİL)",
    v1Lines.join("|") === EXPECTED_ORDER.join("|"),
    v1Lines.map((d) => d.slice(-2)).join(","),
  );

  const ordDetail = (await chequeDeliveryNoteService.findById(ordId)) as {
    data: { items: Array<{ cheque: { docNo: string } }> };
  };
  const detailOrder = ordDetail.data.items.map((i) => i.cheque.docNo);
  check(
    "§9b ⭐ Detay ucu KÂĞITLA aynı sırayı döner (ekran ≠ kâğıt olamaz)",
    detailOrder.join("|") === v1Lines.join("|"),
    detailOrder.map((d) => d.slice(-2)).join(","),
  );

  await printedDocumentService.reissue(
    PrintedDocType.CHEQUE_DELIVERY_NOTE,
    ordId,
    `${TAG} sıra denemesi revizyonu`,
    actor.id,
  );
  const v2Lines = await linesOf(ordId, 2);
  check(
    "§9c ⭐ REVİZYON (v2) v1 ile AYNI sırayı basar (SIRA numaraları kaymaz)",
    v2Lines.length === 3 && v2Lines.join("|") === v1Lines.join("|"),
    `v1=${v1Lines.map((d) => d.slice(-2)).join(",")} v2=${v2Lines.map((d) => d.slice(-2)).join(",")}`,
  );

  const ordHtml =
    (await printedDocumentService.getHtml(PrintedDocType.CHEQUE_DELIVERY_NOTE, ordId)).data?.html ??
    "";
  check(
    "§9d Kâğıtta da aynı sıra (ilk basılan çek EN ERKEN vadeli)",
    ordHtml.indexOf(o2.docNo) < ordHtml.indexOf(o3.docNo) &&
      ordHtml.indexOf(o3.docNo) < ordHtml.indexOf(o1.docNo),
  );

  // ── §10 "ZATEN AKTİF BİR BORDRODA" ONAYLATMASI ──────────────────────────
  // ⚠️ ENGEL DEĞİL ONAY: aynı çek meşru olarak yeniden teslim edilebilir
  // (tahsile ver → karşılıksız dön → ciro et). Kapatılan şey SESSİZLİK:
  // düzeltmek isteyen kullanıcı eski bordroyu ACTIVE bırakıp aynı çekler için
  // ikinci bir tutanak imzalatırdı (aynı denemenin tekrarını `clientToken` tek
  // bordroya indirir — `test_cek_bordro_taslak_token`).
  const dupErr = await expectReject(() =>
    chequeDeliveryNoteService.create({ chequeIds: [o1.id] }, actor.id),
  );
  check(
    "§10a ⭐ Aktif bordroda duran çek UYARIR (409)",
    (dupErr ?? "").includes("AKTİF bir teslim bordrosunda"),
    dupErr ?? "hata ATILMADI",
  );
  check(
    "§10b Uyarı MAKİNE-OKUNUR kod + hangi bordro/çek olduğunu taşır",
    (dupErr ?? "").includes((await prisma.chequeDeliveryNote.findUniqueOrThrow({
      where: { id: ordId }, select: { docNo: true },
    })).docNo),
    ALREADY_IN_ACTIVE_NOTE,
  );
  const confirmed = await chequeDeliveryNoteService.create(
    { chequeIds: [o1.id], confirmDuplicate: true },
    actor.id,
  );
  const confirmedId = (confirmed.data as { id: string }).id;
  noteIds.push(confirmedId);
  check(
    "§10c ⭐ `confirmDuplicate` ile GEÇİLİR (meşru ikinci teslim engellenmez)",
    Boolean(confirmedId),
    (confirmed.data as { docNo: string }).docNo,
  );

  // İPTAL edilmiş bordro engellemez: iptal edilmiş tutanak "yok" sayılmıştır ve
  // yenisini kesmek tam da beklenen yoldur (aksi halde iptal işe yaramazdı).
  const o4 = await mkCheque(ChequeKind.RECEIVED, 40, Currency.TRY, ChequeStatus.PORTFOLIO, "O4", 12);
  const tmp = await chequeDeliveryNoteService.create({ chequeIds: [o4.id] }, actor.id);
  const tmpId = (tmp.data as { id: string }).id;
  noteIds.push(tmpId);
  await chequeDeliveryNoteService.cancel(tmpId, `${TAG} iptal`, actor.id);
  const afterCancel = await chequeDeliveryNoteService
    .create({ chequeIds: [o4.id] }, actor.id)
    .then((r) => (r.data as { id: string }).id)
    .catch(() => null);
  if (afterCancel) noteIds.push(afterCancel);
  check(
    "§10d ⭐ İPTAL edilmiş bordro yeni bordroyu ENGELLEMEZ",
    afterCancel !== null,
    afterCancel ? "yeni bordro kesildi" : "409 verdi — iptal işe yaramaz olurdu",
  );

  // ── §11 `asOf` GÜN SINIRI SINIR KATMANINDA ──────────────────────────────
  // ⚠️ İSTEMCİYE GÜVENİLMEZ: Electron `dayEndIso` gönderiyor, ama gün-YALNIZ bir
  // değer (`2026-07-31`) ECMAScript'te UTC gece yarısıdır → Europe/Istanbul'da o
  // günün ~21 saati sınırın DIŞINDA kalır. İkinci bir istemci (mobil, script,
  // Swagger'dan elle deneme) aynı ucu çağırdığı gün, DONMUŞ resmi belge doğru
  // görünen ama EKSİK bir bakiye basar — hata yok, log yok, kâğıt basılmış olur.
  const lateAnchor = new Date(asOf.getTime() - 400 * DAY);
  const lateYmd = factoryYmd(lateAnchor);
  // O günün YEREL 23:30'u — naif `new Date("YYYY-MM-DD")` sınırının dışında,
  // gerçek gün sonunun içinde.
  await prisma.cariTransaction.create({
    data: {
      cariId: cari.id,
      currency: Currency.TRY,
      txnDate: new Date(factoryDayEnd(lateAnchor).getTime() - 30 * 60_000),
      debit: 77,
      credit: 0,
      amountTry: 77,
      exchangeRate: 1,
      sourceType: CariTxnSource.ADJUSTMENT,
      description: `${TAG} gece hareketi`,
      createdById: actor.id,
    },
  });
  const naive = await deriveCariBalancesAsOf(prisma, cari.id, new Date(lateYmd));
  const bounded = await deriveCariBalancesAsOf(prisma, cari.id, resolveRangeEnd(lateYmd));
  check(
    "§11z KÖRLÜK ZEMİNİ: naif dönüşüm gerçekten DÜŞÜRÜYOR (kontrol ayırt edici)",
    (naive.find((r) => r.currency === Currency.TRY)?.debit.toString() ?? "0") === "0",
    `naif debit=${naive.find((r) => r.currency === Currency.TRY)?.debit.toString() ?? "satır yok"}`,
  );
  check(
    "§11a ⭐ Gün-yalnız `asOf` O GÜNÜN SONUNA çözülür (gece hareketi DAHİL)",
    bounded.find((r) => r.currency === Currency.TRY)?.debit.toString() === "77",
    `sınırlı debit=${bounded.find((r) => r.currency === Currency.TRY)?.debit.toString()}`,
  );
  check(
    "§11b Gün sonu YEREL 23:59:59.999'dur (UTC gece yarısı DEĞİL)",
    resolveRangeEnd(lateYmd).getTime() === factoryDayEnd(lateAnchor).getTime() &&
      resolveRangeEnd(lateYmd).getTime() > new Date(lateYmd).getTime(),
    resolveRangeEnd(lateYmd).toISOString(),
  );
  check(
    "§11c TAM ISO damgası AYNEN kullanılır (istemcinin seçtiği an ezilmez)",
    resolveRangeEnd("2026-07-31T10:00:00.000Z").toISOString() === "2026-07-31T10:00:00.000Z",
  );
  // ⚠️ YORUMLAR AYIKLANIR: yasaklı deseni ANLATAN yorum satırı, deseni KULLANAN
  // koddan ayırt edilemezse kontrol ilk yazımda kendi belgesine takılır (takıldı).
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|\*).*$/gm, "");
  const letterRoutesSrc = stripComments(
    readFileSync(resolvePath(__dirname, "../src/routes/reconciliation-letter.routes.ts"), "utf8"),
  );
  check(
    "§11d ⭐ ROTA sınırı ELLE kurmuyor (`new Date(b.asOf)` YASAK)",
    letterRoutesSrc.includes("endBoundary(b.asOf)") && !letterRoutesSrc.includes("new Date(b.asOf)"),
  );
  const bordroRoutesSrc = stripComments(
    readFileSync(resolvePath(__dirname, "../src/routes/cheque-delivery-note.routes.ts"), "utf8"),
  );
  check(
    "§11e Liste süzgeçleri de sınır yardımcılarından geçer (iki rota da)",
    [letterRoutesSrc, bordroRoutesSrc].every(
      (s) => s.includes("endBoundary(q.to)") && s.includes("startBoundary(q.from)"),
    ),
  );

  // ── §12 MEKTUP DÖNEM MÜHRÜNDEN OKUMAZ (bilinçli karar, kilitli) ─────────
  // ⚠️ Gerekçe `reconciliation-letter.service` başlığında: mühür yalnız NET
  // `closingBalance` taşır, mektup ise BORÇ|ALACAK|BAKİYE üçlüsünü basar —
  // bakiyeyi mühürden, borç/alacağı defterden almak KENDİ ARİTMETİĞİ TUTMAYAN
  // bir resmi kâğıt üretirdi. Bu bölüm kararı ölçer: bilerek YANLIŞ bir mühür
  // kurulur ve mektubun yine DEFTER gerçeğini bastığı doğrulanır.
  await prisma.cariPeriodClose.create({
    data: {
      cariId: cari.id,
      currency: Currency.TRY,
      periodEnd: factoryDayKeyUtcMidnight(new Date(asOf.getTime() - 7 * DAY)),
      closingBalance: 999999,
      txnCount: 0,
      notes: `${TAG} kasıtlı yanlış mühür`,
    },
  });
  const truth = await deriveCariBalancesAsOf(prisma, cari.id, asOf);
  const sealedLetter = await reconciliationLetterService.create({ cariId: cari.id, asOf }, actor.id);
  const sealedId = (sealedLetter.data as { id: string }).id;
  letterIds.push(sealedId);
  const sealedDocs = await docsOf(sealedId, PrintedDocType.RECONCILIATION_LETTER);
  const sealedSnap = (sealedDocs[0]?.snapshot as { doc?: { balances?: SnapBalance[] } } | null)?.doc
    ?.balances ?? [];
  const sealedTry = sealedSnap.find((b) => b.currency === "TRY");
  check(
    "§12z KÖRLÜK ZEMİNİ: mühür kuruldu ve defterle ÇELİŞİYOR",
    truth.find((r) => r.currency === Currency.TRY)?.balance.toString() !== "999999",
    `defter=${truth.find((r) => r.currency === Currency.TRY)?.balance.toString()} mühür=999999`,
  );
  check(
    "§12a ⭐ Mektup DEFTER gerçeğini basar (mühür rakamı DEĞİL)",
    sealedTry?.balance === truth.find((r) => r.currency === Currency.TRY)?.balance.toString() &&
      sealedTry?.balance !== "999999",
    `kâğıt=${sealedTry?.balance}`,
  );
  check(
    "§12b ⭐ Her satırın aritmetiği KENDİ İÇİNDE tutar (borç − alacak = bakiye)",
    sealedSnap.length > 0 &&
      sealedSnap.every((b) => Number(b.debit) - Number(b.credit) === Number(b.balance)),
    sealedSnap.map((b) => `${b.currency}:${b.debit}-${b.credit}=${b.balance}`).join(" "),
  );
  const letterSrc = readFileSync(
    resolvePath(__dirname, "../src/services/reconciliation-letter.service.ts"),
    "utf8",
  );
  check(
    "§12c Servis dönem kapanışını HİÇ import etmez (karar kaynakta da net)",
    !letterSrc.includes("period-close"),
  );
  check(
    "§12d Karar GEREKÇESİYLE yazılı (sonraki kişi 'eksik' sanıp mühre bağlamasın)",
    letterSrc.includes("CariPeriodClose") && letterSrc.includes("closingBalance"),
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    for (const [key, eski] of ayarYedek) {
      await (eski
        ? prisma.systemSetting.update({ where: { key }, data: { value: eski.value as never } })
        : prisma.systemSetting.delete({ where: { key } })
      ).catch((e: unknown) => {
        fail++;
        console.error(`  ❌ temizlik "${key} geri" düştü: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
    // ⚠️ TEMİZLİK FİKSTÜRDEN TÜRETİLİR, test gövdesindeki id defterinden DEĞİL.
    // Sebep ölçüldü: negatif sonda koşarken (tek-yön guard'ı kaldırılmış hâlde)
    // "reddedilmeli" denen çağrı BAŞARILI oldu ve doğan bordronun id'si hiçbir
    // yere yazılmadı — sızan pivot satırı, RESTRICT FK ile çeklerin silinmesini
    // de engelledi ve ardından TÜM fikstür (müşteri/cari/çekler) dev DB'sinde
    // kaldı. Sonda çalıştıran bir bekçi, tam da sondanın koştuğu turda sızmaya
    // en yatkın olandır; bu yüzden küme fikstürün KENDİSİNDEN (cari + çekler)
    // yeniden çözülür.
    const leakedNotes = chequeIds.length
      ? await prisma.chequeDeliveryNoteItem.findMany({
          where: { chequeId: { in: chequeIds } },
          select: { noteId: true },
        })
      : [];
    const leakedLetters = cariId
      ? await prisma.reconciliationLetter.findMany({ where: { cariId }, select: { id: true } })
      : [];
    const allNoteIds = [...new Set([...noteIds, ...leakedNotes.map((n) => n.noteId)])];
    const allLetterIds = [...new Set([...letterIds, ...leakedLetters.map((l) => l.id)])];

    // FK sırası: pivot → belge kaydı → printedDocument → cheque →
    // cariTransaction → cariBalance → cariAccount → bankAccount → customer.
    const srcIds = [...allLetterIds, ...allNoteIds];
    if (allNoteIds.length > 0) {
      await prisma.chequeDeliveryNoteItem.deleteMany({ where: { noteId: { in: allNoteIds } } });
      await prisma.chequeDeliveryNote.deleteMany({ where: { id: { in: allNoteIds } } });
    }
    if (allLetterIds.length > 0) {
      await prisma.reconciliationLetter.deleteMany({ where: { id: { in: allLetterIds } } });
    }
    if (srcIds.length > 0) {
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: srcIds } } });
    }
    if (chequeIds.length > 0) {
      await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
      await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
    }
    if (cariId) {
      await prisma.cariTransaction.deleteMany({ where: { cariId } });
      await prisma.cariBalance.deleteMany({ where: { cariId } });
      // §12'nin kasıtlı YANLIŞ mührü — cari RESTRICT FK ile bağlı, önce o düşer.
      await prisma.cariPeriodClose.deleteMany({ where: { cariId } });
      await prisma.cariAccount.deleteMany({ where: { id: cariId } });
    }
    if (bankAccountId) await prisma.bankAccount.deleteMany({ where: { id: bankAccountId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
