// =============================================================================
// BEKÇİ — KURULUM GÜNÜ: devir bakiyeleri · carisiz kasa hareketi · virman
// =============================================================================
// Çalıştırma: npx tsx scripts/test_finance_opening.ts
//
// NEDEN: Bir firmanın programa geçtiği GÜN, sistemdeki her rakamın doğruluğu
// buraya bağlıdır. Devir girilemezse ya da yanlış girilirse hiçbir bakiye,
// hiçbir ekstre ve hiçbir yaşlandırma doğru olamaz — ve yanlışlığın kaynağı
// aylar sonra bile bulunamaz.
//
// İkinci konu: kasa bakiyesinin artık İKİ YAZARI var (Payment + CashTransaction).
// Bu, mutabakat formülünün en kolay unutulan genişlemesi; unutulursa ilk masraf
// fişinde §23 kırmızı verir (iyi) ya da daha kötüsü, formül tek-yazarlı kalıp
// yanlış "drift" raporlar.
//
// ÖLÇÜLENLER:
//   §1 Cari devir: defter satırı (ADJUSTMENT) + bakiye; POZİTİF=borçlu,
//      NEGATİF=alacaklı; İKİNCİ devir 409 (mesaj GERÇEK yolu gösterir)
//   §2 ⭐ Devir bakiyeye ELLE YAZILMAZ — defterden türer (§21 mutabakatı)
//   §3 Masraf fişi (carisiz): kasa bakiyesi düşer, CARİ defterine satır YOK
//   §4 Açılış hesap başına TEK (partial unique + anlamlı 409)
//   §5 ⭐ VİRMAN: tek uç iki satır, aynı grup, çıkan+giren dengeli, iki bakiye
//   §6 ⭐ Virman İPTALİ İKİ BACAĞI birden alır (tek bacak iptali yasak)
//   §7 Tür↔yön tutarlılığı DB'de kilitli (gider yön IN olamaz)
//   §8 Farklı para birimli virman reddedilir (kur işlemi ≠ virman)
//   §9 İdempotency: aynı clientToken ikinci kayıt açmaz
//   §10 ⭐ DEVİR STORNOSU (Sınıf 2): ADJUSTMENT_CANCEL ters satırı reversesTxnId
//       bağıyla + bakiye eski değere döner + orijinal satır durur (append-only)
//       + ters kayıt BUGÜNE yazılır + aging storno sonrası cariyi NET görür
//   §11 ⭐ Kapanmış dönem FOTOĞRAFI değişmez (kapanış al → storno → verify tutar)
//   §12 Çift storno: servis 404 (yol gösteren mesaj) + DB seddi (partial unique
//       → ikinci ters satır P2002)
//   §13 Storno sonrası YENİ devir girilebilir + aging DEVİR satırı NET
//       (eski 8000 görünmez, sahte "defter uyuşmuyor" bandı YOK — negatif
//       sonda: aging FILTER'ından ADJUSTMENT_CANCEL düşürülünce kırmızı)
//   §14 ⭐ TOCTOU: 5 paralel setOpeningBalance → TEK kayıt (kilit dup-kontrolün
//       ÖNÜNDE — negatif sonda: kilit dup-kontrolün arkasına alınınca kırmızı)
// =============================================================================
import { Prisma, CashTxnKind, PaymentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { cariService } from "../src/services/cari.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { periodCloseService } from "../src/services/period-close.service";
import { getAgingReport } from "../src/services/reports/finance-aging.report";
import { D } from "../src/services/helpers/finance.helper";

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

const TAG = `TEST-OPEN-${Date.now()}`;
const cashBoxIds: string[] = [];
const bankIds: string[] = [];
const cariIds: string[] = [];
const customerIds: string[] = [];

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const boxBalance = async (id: string) =>
  D((await prisma.cashBox.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);
const bankBalance = async (id: string) =>
  D((await prisma.bankAccount.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);

async function main(): Promise<void> {
  console.log("=== Kurulum günü bekçisi ===\n");

  // Bekçi KENDİ fixture'ını yaratır (ortam verisine dokunmaz).
  const customer = await prisma.customer.create({
    data: { code: TAG, name: `${TAG} Müşteri` },
    select: { id: true },
  });
  customerIds.push(customer.id);
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: customer.id },
    select: { id: true },
  });
  cariIds.push(cari.id);

  const box = await prisma.cashBox.create({
    data: { code: `${TAG}-KS`, name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxIds.push(box.id);
  const bank = await prisma.bankAccount.create({
    data: { code: `${TAG}-BN`, name: `${TAG} Banka`, currency: "TRY" },
    select: { id: true },
  });
  bankIds.push(bank.id);

  // ── §1 CARİ DEVİR ───────────────────────────────────────────────────────
  await cariService.setOpeningBalance({ cariId: cari.id, currency: "TRY", balance: 15000, description: "2025 devri" });
  const txns = await prisma.cariTransaction.findMany({
    where: { cariId: cari.id, sourceType: "ADJUSTMENT" },
    select: { debit: true, credit: true, description: true },
  });
  check("§1a Devir TEK defter satırı yazdı", txns.length === 1, `satır=${txns.length}`);
  check("§1b POZİTİF devir BORÇ kolonuna (cari bize borçlu)", txns[0] ? D(txns[0].debit).equals(15000) : false);
  const bal = await prisma.cariBalance.findUniqueOrThrow({
    where: { cariId_currency: { cariId: cari.id, currency: "TRY" } },
    select: { balance: true },
  });
  check("§1c Bakiye devir kadar", D(bal.balance).equals(15000), `bakiye=${bal.balance}`);

  const dupErr = await expectError(() =>
    cariService.setOpeningBalance({ cariId: cari.id, currency: "TRY", balance: 999 }),
  );
  check("§1d İKİNCİ devir REDDEDİLDİ", /zaten girilmiş/i.test(dupErr), dupErr.slice(0, 70));
  // 409 mesajı GERÇEK yolu göstermeli — eski mesaj var olmayan bir ucu
  // ("ters bir düzeltme kaydı girin") gösteriyordu (Sınıf 2'nin kök bulgusu).
  check("§1d2 409 mesajı GERÇEK yolu gösteriyor (Devri İptal Et)", /Devri İptal Et/.test(dupErr), dupErr.slice(0, 110));

  // Negatif devir (biz borçluyuz) — farklı para biriminde.
  await cariService.setOpeningBalance({ cariId: cari.id, currency: "USD", balance: -500, description: "USD devri" });
  const usdBal = await prisma.cariBalance.findUniqueOrThrow({
    where: { cariId_currency: { cariId: cari.id, currency: "USD" } },
    select: { balance: true },
  });
  check("§1e NEGATİF devir alacak kolonuna (biz borçluyuz)", D(usdBal.balance).equals(-500), `bakiye=${usdBal.balance}`);

  // ── §2 DEFTERDEN TÜRER (mutabakat) ──────────────────────────────────────
  const drift = await prisma.$queryRaw<Array<{ c: string }>>`
    SELECT b."cariId"::text AS c FROM cari_balances b
    LEFT JOIN (SELECT "cariId", currency, SUM(debit)-SUM(credit) AS t
                 FROM cari_transactions GROUP BY "cariId", currency) x
      ON x."cariId"=b."cariId" AND x.currency=b.currency
    WHERE b."cariId" = ${cari.id}::uuid AND b.balance <> COALESCE(x.t, 0)`;
  check("§2 ⭐ Devir bakiyesi DEFTERDEN türüyor (elle yazılmadı)", drift.length === 0);

  // ── §3 MASRAF FİŞİ (carisiz) ────────────────────────────────────────────
  const cariTxnBefore = await prisma.cariTransaction.count();
  await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId: box.id,
    amount: 2500,
    category: "Kira",
    description: "Ağustos kirası",
  });
  check("§3a Masraf kasadan DÜŞTÜ", (await boxBalance(box.id)).equals(-2500), `bakiye=${await boxBalance(box.id)}`);
  check(
    "§3b ⭐ Carisiz hareket CARİ deftere satır YAZMADI",
    (await prisma.cariTransaction.count()) === cariTxnBefore,
  );

  // ── §4 AÇILIŞ HESAP BAŞINA TEK ──────────────────────────────────────────
  await cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 10000, description: "Kasa devri" });
  check("§4a Açılış kasaya girdi", (await boxBalance(box.id)).equals(7500), `bakiye=${await boxBalance(box.id)}`);
  const openErr = await expectError(() =>
    cashTransactionService.create({ kind: "OPENING", cashBoxId: box.id, amount: 1 }),
  );
  check("§4b İKİNCİ açılış REDDEDİLDİ (anlamlı mesaj)", /açılış bakiyesi zaten/i.test(openErr), openErr.slice(0, 70));

  // ── §5 VİRMAN ───────────────────────────────────────────────────────────
  const tr = await cashTransactionService.transfer({ fromCashBoxId: box.id, toBankAccountId: bank.id, amount: 3000 });
  check("§5a Tek uç İKİ belge üretti", tr.data.docNos.length === 2, tr.data.docNos.join(" / "));
  const legs = await prisma.cashTransaction.findMany({
    where: { id: { in: tr.data.ids } },
    select: { kind: true, direction: true, amount: true, transferGroupId: true },
  });
  check(
    "§5b Bacaklar AYNI grupta ve zıt yönde",
    legs.length === 2 &&
      legs[0]?.transferGroupId === legs[1]?.transferGroupId &&
      new Set(legs.map((l) => l.direction)).size === 2,
  );
  check("§5c Kasa düştü", (await boxBalance(box.id)).equals(4500), `kasa=${await boxBalance(box.id)}`);
  check("§5d Banka arttı", (await bankBalance(bank.id)).equals(3000), `banka=${await bankBalance(bank.id)}`);

  // ── §6 VİRMAN İPTALİ İKİ BACAK ──────────────────────────────────────────
  await cashTransactionService.cancel(tr.data.ids[0] as string, "bekçi");
  const cancelled = await prisma.cashTransaction.findMany({
    where: { id: { in: tr.data.ids } },
    select: { status: true },
  });
  check(
    "§6a ⭐ Tek bacak iptali İKİ bacağı birden aldı",
    cancelled.every((c) => c.status === PaymentStatus.CANCELLED),
    `iptal=${cancelled.filter((c) => c.status === "CANCELLED").length}/2`,
  );
  check("§6b Kasa geri döndü", (await boxBalance(box.id)).equals(7500), `kasa=${await boxBalance(box.id)}`);
  check("§6c Banka geri döndü", (await bankBalance(bank.id)).isZero(), `banka=${await bankBalance(bank.id)}`);

  // ── §7 TÜR↔YÖN DB'DE KİLİTLİ ────────────────────────────────────────────
  // Servis doğru yönü kendisi koyuyor; burada ölçülen DB seddi — servis bir gün
  // yanlış yön yazsa bile satır DB'ye giremesin.
  const chkErr = await expectError(() =>
    prisma.$executeRaw`INSERT INTO cash_transactions
      ("id","docNo","kind","direction","status","cashBoxId","currency","exchangeRate","amount","amountTry","txnDate","createdAt","updatedAt")
      VALUES (gen_random_uuid(), ${`${TAG}-BAD`}, 'EXPENSE', 'IN', 'ACTIVE', ${box.id}::uuid, 'TRY', 1, 100, 100, now(), now(), now())`,
  );
  check("§7 Gider yönü IN olamaz (CHECK)", /kind_matches_direction/i.test(chkErr), chkErr.slice(0, 60));

  // ── §8 FARKLI PARA BİRİMLİ VİRMAN ───────────────────────────────────────
  const usdBox = await prisma.cashBox.create({
    data: { code: `${TAG}-USD`, name: `${TAG} USD Kasa`, currency: "USD" },
    select: { id: true },
  });
  cashBoxIds.push(usdBox.id);
  const curErr = await expectError(() =>
    cashTransactionService.transfer({ fromCashBoxId: box.id, toCashBoxId: usdBox.id, amount: 100 }),
  );
  check("§8 Farklı para birimli virman REDDEDİLDİ", /farklı para birimleri/i.test(curErr), curErr.slice(0, 70));

  // ── §9 İDEMPOTENCY ──────────────────────────────────────────────────────
  const token = crypto.randomUUID();
  const first = await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId: box.id,
    amount: 50,
    clientToken: token,
  });
  const second = await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId: box.id,
    amount: 50,
    clientToken: token,
  });
  check("§9a Aynı token ikinci kayıt AÇMADI", first.data.id === second.data.id, `${first.data.docNo}`);
  check("§9b Bakiye TEK kez düştü", (await boxBalance(box.id)).equals(7450), `kasa=${await boxBalance(box.id)}`);

  // ── §10 DEVİR STORNOSU (Sınıf 2) ────────────────────────────────────────
  // Taze cari: §1'in fixture'ına dokunmadan (oradaki aktif devir §1d'nin
  // dayanağı) storno yaşam döngüsünün tamamı burada ölçülür.
  const customer2 = await prisma.customer.create({
    data: { code: `${TAG}-2`, name: `${TAG} Müşteri 2` },
    select: { id: true },
  });
  customerIds.push(customer2.id);
  const cari2 = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: customer2.id },
    select: { id: true },
  });
  cariIds.push(cari2.id);

  // Devir GEÇMİŞE tarihli (10 gün önce) — kapanış senaryosu onu kapsayabilsin.
  const DAY = 86_400_000;
  await cariService.setOpeningBalance({
    cariId: cari2.id,
    currency: "TRY",
    balance: 8000,
    txnDate: new Date(Date.now() - 10 * DAY),
    description: "storno testi devri",
  });

  // Dönemi kapat: periodEnd 5 gün önce → devri KAPSAR, bugünü KAPSAMAZ
  // (storno bugüne yazılacak ve açık döneme düşecek).
  const close = await periodCloseService.close({
    cariId: cari2.id,
    currency: "TRY",
    periodEnd: new Date(Date.now() - 5 * DAY),
  });
  check(
    "§10a Kapanış devri kapsadı (fotoğraf: 1 hareket, 8000)",
    close.data.txnCount === 1 && D(close.data.closingBalance).equals(8000),
    `txnCount=${close.data.txnCount} bakiye=${close.data.closingBalance}`,
  );

  // KÖRLÜK ZEMİNİ: aging devir aktifken DEVİR satırını GERÇEKTEN görüyor —
  // "storno sonrası görünmüyor" kontrolü bunsuz vakumen yeşil kalırdı.
  const agingBefore = await getAgingReport({ asOf: new Date(), cariId: cari2.id, includeDetail: true });
  const rowBefore = agingBefore.blocks.flatMap((b) => b.rows).find((r) => r.cariId === cari2.id);
  check(
    "§10b Aging DEVİR satırını görüyor (körlük zemini)",
    rowBefore != null &&
      D(rowBefore.ledgerBalance).equals(8000) &&
      (rowBefore.items ?? []).some((i) => i.type === "ADJUSTMENT" && D(i.netOpen).equals(8000)),
    `ledger=${rowBefore?.ledgerBalance}`,
  );

  // STORNO.
  const storno = await cariService.cancelOpeningBalance(
    { cariId: cari2.id, currency: "TRY", reason: "bekçi — yanlış tutar girildi" },
  );
  const bal2 = await prisma.cariBalance.findUniqueOrThrow({
    where: { cariId_currency: { cariId: cari2.id, currency: "TRY" } },
    select: { balance: true },
  });
  check("§10c ⭐ Storno bakiyeyi eski değere döndürdü (0)", D(bal2.balance).isZero(), `bakiye=${bal2.balance}`);

  const revRow = await prisma.cariTransaction.findFirst({
    where: { cariId: cari2.id, sourceType: "ADJUSTMENT_CANCEL" },
    select: { id: true, debit: true, credit: true, amountTry: true, exchangeRate: true, reversesTxnId: true, txnDate: true, description: true },
  });
  check(
    "§10d Ters satır ADJUSTMENT_CANCEL + reversesTxnId bağı",
    revRow != null && revRow.reversesTxnId != null && revRow.id === storno.data.id && revRow.reversesTxnId === storno.data.reversesTxnId,
  );
  check(
    "§10e Debit↔credit birebir ters, amountTry/kur AYNEN",
    revRow != null &&
      D(revRow.credit).equals(8000) &&
      D(revRow.debit).isZero() &&
      D(revRow.amountTry).equals(8000) &&
      D(revRow.exchangeRate).equals(1),
  );
  check(
    "§10f Ters kayıt BUGÜNE yazıldı (devrin tarihine DEĞİL)",
    revRow != null && Date.now() - revRow.txnDate.getTime() < 60_000,
    `txnDate=${revRow?.txnDate.toISOString()}`,
  );
  check(
    "§10g Orijinal devir satırı DURUYOR (append-only) + sebep ters satırda",
    (await prisma.cariTransaction.count({ where: { cariId: cari2.id, sourceType: "ADJUSTMENT" } })) === 1 &&
      /yanlış tutar girildi/.test(revRow?.description ?? ""),
  );

  // ── §10x EKSTRE SATIRLARI TERS-KAYIT BAĞINI TAŞIR (I3, 2026-08-14) ────────
  // Panel aktif-devir tespitini bu KESİN bilgiyle yapar (statementDevir kesin
  // yolu); alan düşerse panel sezgisel fallback'e iner ve nadir pencerede
  // yanlış-pozitif geri gelir — bu kontrol o gerilemeyi kilitler.
  {
    const stmt = await cariService.statement({
      cariId: cari2.id,
      currency: "TRY",
      from: new Date(Date.now() - 400 * 24 * 3600 * 1000),
      to: new Date(Date.now() + 24 * 3600 * 1000),
    });
    const adjRow = stmt.data.rows.find((r) => r.sourceType === "ADJUSTMENT");
    const cancelRow = stmt.data.rows.find((r) => r.sourceType === "ADJUSTMENT_CANCEL");
    check(
      "§10x ⭐ Ekstrede terslenen devir reversedByTxnId, ters satır reversesTxnId taşır",
      adjRow != null &&
        cancelRow != null &&
        adjRow.reversedByTxnId === cancelRow.id &&
        cancelRow.reversesTxnId === adjRow.id &&
        cancelRow.reversedByTxnId == null,
      `adj.reversedBy=${adjRow?.reversedByTxnId} cancel.reverses=${cancelRow?.reversesTxnId}`,
    );
  }

  // Storno sonrası aging: DEVİR neti sıfır → cari hiç listelenmez (ne satır
  // ne sahte "defter uyuşmuyor" bandı). Negatif sonda: FILTER'dan
  // ADJUSTMENT_CANCEL düşürülünce adjNet=8000 kalır ve satır geri gelir.
  const agingAfter = await getAgingReport({ asOf: new Date(), cariId: cari2.id, includeDetail: true });
  const rowsAfter = agingAfter.blocks.flatMap((b) => b.rows).filter((r) => r.cariId === cari2.id);
  check("§10h ⭐ Aging storno sonrası cariyi NET görüyor (satır yok)", rowsAfter.length === 0, `satır=${rowsAfter.length}`);
  check("§10i Aging mutabakatı temiz (mismatch yok)", agingAfter.reconciliation.mismatchedRows === 0);

  // ── §11 KAPANMIŞ DÖNEM FOTOĞRAFI DEĞİŞMEZ ──────────────────────────────
  // Ters kayıt bugüne düştüğü için kapanışın kapsadığı pencere aynen durur:
  // yeniden türetilen bakiye ve txnCount fotoğrafla BİREBİR tutmalı.
  const verify = await periodCloseService.verify(close.data.id);
  check(
    "§11 ⭐ Storno kapanış fotoğrafını DEĞİŞTİRMEDİ (drift yok)",
    verify.data.drift === false &&
      verify.data.countDelta === 0 &&
      D(verify.data.balanceDelta).isZero() &&
      D(verify.data.derived.closingBalance).equals(8000),
    `drift=${verify.data.drift} ΔtxnCount=${verify.data.countDelta} Δbakiye=${verify.data.balanceDelta}`,
  );

  // ── §12 ÇİFT STORNO ─────────────────────────────────────────────────────
  // Servis katmanı: aktif devir kalmadı → 404, mesaj yol gösterir.
  const twiceErr = await expectError(() =>
    cariService.cancelOpeningBalance({ cariId: cari2.id, currency: "TRY", reason: "bekçi — ikinci deneme" }),
  );
  check(
    "§12a İkinci storno REDDEDİLDİ (aktif devir yok, mesaj yol gösterir)",
    /iptal edilecek/i.test(twiceErr) && /devri yok/i.test(twiceErr),
    twiceErr.slice(0, 90),
  );
  // DB seddi: aynı orijinale İKİNCİ ters satır — partial unique
  // (`reversesTxnId WHERE NOT NULL`) P2002 ile durdurur. Servis atlansa
  // (ham SQL, bekçisiz refactor) satırın kendisi direnir.
  const dupRevErr = await expectError(() =>
    prisma.cariTransaction.create({
      data: {
        cariId: cari2.id,
        currency: "TRY",
        txnDate: new Date(),
        debit: 0,
        credit: 8000,
        amountTry: 8000,
        exchangeRate: 1,
        sourceType: "ADJUSTMENT_CANCEL",
        reversesTxnId: storno.data.reversesTxnId,
        description: "bekçi — çift storno sondası",
      },
    }),
  );
  check(
    "§12b ⭐ DB seddi: aynı orijinale ikinci ters satır P2002",
    /unique constraint/i.test(dupRevErr),
    dupRevErr.replace(/\s+/g, " ").slice(0, 120),
  );

  // ── §13 STORNO SONRASI YENİ DEVİR + AGING NET ───────────────────────────
  await cariService.setOpeningBalance({
    cariId: cari2.id,
    currency: "TRY",
    balance: 4250,
    description: "düzeltilmiş devir",
  });
  const bal3 = await prisma.cariBalance.findUniqueOrThrow({
    where: { cariId_currency: { cariId: cari2.id, currency: "TRY" } },
    select: { balance: true },
  });
  check("§13a ⭐ Storno sonrası YENİ devir girilebildi", D(bal3.balance).equals(4250), `bakiye=${bal3.balance}`);

  // Aging DEVİR satırı NET: 8000 − 8000 + 4250 = 4250. FILTER
  // ADJUSTMENT_CANCEL'ı netlemezse burada 12250 görünür ve reconDiff 8000'lik
  // sahte "defter uyuşmuyor" bandı basar (negatif sondanın kırmızısı).
  const agingNet = await getAgingReport({ asOf: new Date(), cariId: cari2.id, includeDetail: true });
  const rowNet = agingNet.blocks.flatMap((b) => b.rows).find((r) => r.cariId === cari2.id);
  const devirItems = (rowNet?.items ?? []).filter((i) => i.type === "ADJUSTMENT");
  check(
    "§13b ⭐ Aging DEVİR satırı storno sonrası NET (4250, eski 8000 görünmez)",
    rowNet != null && devirItems.length === 1 && D(devirItems[0]!.netOpen).equals(4250),
    `devir=${devirItems.map((i) => i.netOpen).join(",")}`,
  );
  check(
    "§13c ⭐ Sahte 'defter uyuşmuyor' bandı YOK (reconDiff=0)",
    rowNet != null && D(rowNet.reconDiff).isZero() && agingNet.reconciliation.mismatchedRows === 0,
    `reconDiff=${rowNet?.reconDiff}`,
  );

  // ── §14 TOCTOU: 5 PARALEL DEVİR → TEK KAYIT ─────────────────────────────
  // Dup-kontrolü kilidin ARKASINDA kalsaydı (eski kod) 5 istek de "devir yok"
  // görür, kilitte serileşir ve 5 satır yazardı (KK1 tuzağının birebir
  // tekrarı). `Promise.allSettled` MEŞRU: beş AYRI tx, tek tx client'ı
  // paylaşılmıyor (perf kuralı 11 tx-içi paralelliği yasaklar).
  const customer3 = await prisma.customer.create({
    data: { code: `${TAG}-3`, name: `${TAG} Müşteri 3` },
    select: { id: true },
  });
  customerIds.push(customer3.id);
  const cari3 = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: customer3.id },
    select: { id: true },
  });
  cariIds.push(cari3.id);

  const raceResults = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      cariService.setOpeningBalance({ cariId: cari3.id, currency: "TRY", balance: 1000 }),
    ),
  );
  const raceOk = raceResults.filter((r) => r.status === "fulfilled").length;
  const race409 = raceResults.filter(
    (r) => r.status === "rejected" && /zaten girilmiş/i.test((r.reason as Error).message),
  ).length;
  check("§14a ⭐ 5 paralel devirden TAM OLARAK 1'i geçti", raceOk === 1, `geçen=${raceOk}`);
  check("§14b Kalan 4'ü anlamlı 409 aldı", race409 === 4, `409=${race409}`);
  const raceRows = await prisma.cariTransaction.count({
    where: { cariId: cari3.id, sourceType: "ADJUSTMENT" },
  });
  const raceBal = await prisma.cariBalance.findUniqueOrThrow({
    where: { cariId_currency: { cariId: cari3.id, currency: "TRY" } },
    select: { balance: true },
  });
  check("§14c Defterde TEK devir satırı var", raceRows === 1, `satır=${raceRows}`);
  check("§14d Bakiye TEK devir kadar (1000)", D(raceBal.balance).equals(1000), `bakiye=${raceBal.balance}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.cashTransaction.deleteMany({
      where: { OR: [{ cashBoxId: { in: cashBoxIds } }, { bankAccountId: { in: bankIds } }] },
    });
    if (cariIds.length > 0) {
      // İKİ GEÇİŞ: `reversesTxnId` self-FK RESTRICT — orijinal satır, ters
      // satırı dururken silinemez. Önce ters kayıtlar, sonra kalanlar.
      await prisma.cariTransaction.deleteMany({
        where: { cariId: { in: cariIds }, reversesTxnId: { not: null } },
      });
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariPeriodClose.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    if (cashBoxIds.length > 0) await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
    if (bankIds.length > 0) await prisma.bankAccount.deleteMany({ where: { id: { in: bankIds } } });
    if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
