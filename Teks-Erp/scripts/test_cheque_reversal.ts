// =============================================================================
// BEKÇİ — ÇEK TERS YOLLARI (ENDORSE_CANCEL · BOUNCE_CANCEL · RETURN_CANCEL · PAY_CANCEL)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts test_cheque_reversal
//
// NEDEN: BOUNCED/RETURNED/PAID çıkışsız terminaldi, ENDORSED'ın geri yolu yoktu —
// yanlış girilmiş kayıt cari/kasa bakiyesini KALICI yanlış bırakıyordu. Doktrin:
// geri alma ileri satırı ne siler ne değiştirir, bugüne tipli ters satır yazar.
//
// ÖLÇÜLENLER:
//   §0 KÖRLÜK ZEMİNİ — fixture gerçekten defter satırı üretiyor
//   §1 ⭐ CİRO STORNOSU: ciro carisi eski bakiyesine döner · durum ENDORSE'un
//      fromStatus'una (AT_BANK) · endorsedToCariId null · başlık bankası korunur ·
//      orijinal satır DURUR + ters satır reversesTxnId bağlı · ENDORSE ve
//      ENDORSE_CANCEL satırlarının İKİSİ DE counterCariId taşır · ikinci storno 409
//   §2 ⭐ KARŞILIKSIZ STORNOSU (PORTFOLIO'dan): müşteri bakiyesi geri · tek ters satır
//   §3 ⭐ KARŞILIKSIZ STORNOSU (ENDORSED'dan): İKİ cari birden terslenir, her ters
//      satır KENDİ orijinaline bağlı · durum ENDORSED · ardından ciro stornosu zinciri
//   §4 ⭐ İADE STORNOSU alınan + verilen çekte (yön doğru) · zincir: storno → iptal
//   §5 ⭐ ÖDEME STORNOSU: para AYNI hesaba geri · PAY ve PAY_CANCEL CARİ YAZMAZ ·
//      başlık bankası null · GERİYE TARİHLİ ikinci ödemede hesap `createdAt`ten
//   §6 ⭐ MUTABAKAT: kasa defteri raporu + dönem kapanışı önizlemesi + §23/§24
//      formülü PAY_CANCEL sonrası saklı bakiyeyle AYNI
//   §7 ⭐ EŞZAMANLI ÇİFT STORNO → tek ters satır, bakiye tek kez
//   §8 ⭐ TERS KAYIT BUGÜNE: orijinal satırı kapalı dönemde kalan karşılıksız
//      stornosu GEÇER (kapalı dönem fotoğrafı değişmez)
//   §9 Kapılar: sebep zorunlu · yön kapısı · canlı durumda 409 · yol gösteren mesaj
//   §10 ⭐ TEK KAYNAK TRIPWIRE: çek-olayı para kümesi yalnız helper'da; enum ↔ tablo
//   §11 ⭐ BANKAYA VERME STORNOSU (2026-09-14): PORTFOLIO'ya döner · başlık bankası düşer ·
//       banka BAKİYESİ okunarak DEĞİŞMEDİ · DEPOSIT satırı durur, DEPOSIT_CANCEL bankayla ·
//       ters kayıt bugüne · sebep zorunlu · ikinci storno 409 · tahsilden sonra 409 ·
//       COLLECT_CANCEL → AT_BANK → storno MEŞRU · yeniden bankaya verilebilir
//
// NEGATİF SONDA (2026-09-11, son dosyayla; her biri md5 ile birebir geri alındı):
//   ① writeChequeReversalTx aynı tarafı yazdı (borç↔alacak çevrilmedi) → 15 ❌
//   ② cancelEndorse `endorsedToCariId: null` kaldırıldı → DB CHECK
//      `cheques_endorsed_cari` ihlaliyle ÇÖKTÜ (exit 1) — sed DB'de de var
//   ③ ENDORSE_CANCEL olayına counterCariId yazılmadı → 1 ❌ (§1j)
//   ④ helper PAY_CANCEL sign 1 → 0 → 4 ❌ (§6b-e)
//   ⑤ cancelBounce ciro carisinin satırını terslemedi → 4 ❌ (§3)
//   ⑥ ileri olay `createdAt` yerine `eventDate` ile seçildi → 3 ❌ (§5h, §6)
//   ⑦ ters satır bugüne değil 20 gün geriye yazıldı → 2 ❌ (§8)
//   ⑧ kasa defterine elle olay literali geri kondu → 3 ❌ (§6, §10c)
//   ⑨ cancelPay başlık bankasını geri kaldırmadı → 1 ❌ (§5i; ilk turda YEŞİL
//      kalmıştı, kontrol bu sonda üzerine eklendi)
//   ⑩ ters satır reversesTxnId'siz yazıldı → 5 ❌ + ÇÖKTÜ
//   NEGATİF SONDA §11 (2026-09-14, ölçüldü): ⑪ cancelDeposit `requireReversalReason`
//      yerine ham `reason` → §11g ❌ · ⑫ claim'den `bankAccountId: null` düşürüldü →
//      §11b+§11n ❌ · ⑬ defter-beyan çifti geri alındı → test_defter_ters_yol §3e ❌ (beyansız
//      DEPOSIT_CANCEL) · ⑭ olaya `bankAccountId` yazılmadı → §11d+§11n ❌
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CariTxnSource, ChequeEventType, ChequeStatus, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { chequeService } from "../src/services/cheque.service";
import { D } from "../src/services/helpers/finance.helper";
import { periodDayKey } from "../src/services/helpers/period-guard.helper";
import {
  CHEQUE_EVENT_CASH_EFFECT,
  chequeCashEventTypesSql,
  chequeCashInflowSql,
} from "../src/services/helpers/cheque-cash-events.helper";
import { cashPeriodCloseService } from "../src/services/cash-period-close.service";
import { getCashBookReport } from "../src/services/reports/cash-book.report";

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

const TAG = `TEST-CHQREV-${Date.now()}`;
const DAY = 86_400_000;
const customerIds: string[] = [];
const cariIds: string[] = [];
const cashBoxIds: string[] = [];
const bankIds: string[] = [];
const chequeIds: string[] = [];

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const bankBalance = async (id: string) =>
  D((await prisma.bankAccount.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);
const boxBalance = async (id: string) =>
  D((await prisma.cashBox.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);
const cariBalance = async (cariId: string) => {
  const row = await prisma.cariBalance.findUnique({
    where: { cariId_currency: { cariId, currency: "TRY" } },
    select: { balance: true },
  });
  return row ? D(row.balance) : D(0);
};
const header = (id: string) =>
  prisma.cheque.findUniqueOrThrow({
    where: { id },
    select: { status: true, endorsedToCariId: true, bankAccountId: true },
  });
const txnCount = (chequeId: string) => prisma.cariTransaction.count({ where: { chequeId } });
const latestEvent = (chequeId: string, type: ChequeEventType) =>
  prisma.chequeEvent.findFirst({
    where: { chequeId, type },
    orderBy: { createdAt: "desc" },
    select: { fromStatus: true, toStatus: true, counterCariId: true, cashBoxId: true, bankAccountId: true, notes: true },
  });

/** Ters satır + bağlı orijinali — "orijinal durur, ters satır ona bağlı" ölçümü. */
async function reversalPairs(chequeId: string, sourceType: CariTxnSource) {
  const rows = await prisma.cariTransaction.findMany({
    where: { chequeId, sourceType },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, cariId: true, debit: true, credit: true, txnDate: true, reversesTxnId: true,
      reverses: { select: { id: true, cariId: true, debit: true, credit: true, sourceType: true } },
    },
  });
  return rows;
}

async function makeCari(suffix: string): Promise<string> {
  const customer = await prisma.customer.create({
    data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}` },
    select: { id: true },
  });
  customerIds.push(customer.id);
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: customer.id },
    select: { id: true },
  });
  cariIds.push(cari.id);
  return cari.id;
}

async function newCheque(input: Parameters<typeof chequeService.create>[0]): Promise<string> {
  const res = await chequeService.create(input);
  chequeIds.push(res.data.id);
  return res.data.id;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("=== Çek ters yolları bekçisi ===\n");
  const startedAt = new Date();
  const todayKey = periodDayKey(startedAt);
  const due = new Date(Date.now() + 30 * DAY);

  const musteri = await makeCari("MUS");
  const tedarikci = await makeCari("TED");
  const tedarikci2 = await makeCari("TED2");
  const bank = await prisma.bankAccount.create({
    data: { code: `${TAG}-BN`, name: `${TAG} Banka`, currency: "TRY" },
    select: { id: true },
  });
  bankIds.push(bank.id);
  const box = await prisma.cashBox.create({
    data: { code: `${TAG}-KS`, name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxIds.push(box.id);

  // ── §0 KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────
  const c1 = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 4000, dueDate: due });
  check("§0a doğuş cari satırı yazıldı", (await txnCount(c1)) === 1);
  check("§0b fixture bakiyesi sıfır değil", !(await cariBalance(musteri)).isZero(), `${await cariBalance(musteri)}`);

  // ── §1 CİRO STORNOSU ────────────────────────────────────────────────────
  await chequeService.deposit(c1, { bankAccountId: bank.id });
  const tedBeforeEndorse = await cariBalance(tedarikci);
  const musBeforeEndorse = await cariBalance(musteri);
  await chequeService.endorse(c1, { toCariId: tedarikci });
  check("§1a ciro ciro carisine BORÇ yazdı (sonda zemini)", (await cariBalance(tedarikci)).equals(tedBeforeEndorse.plus(4000)));

  await chequeService.cancelEndorse(c1, "yanlış cariye ciro girildi");
  {
    const h = await header(c1);
    check("§1b ⭐ ciro carisi ciro ÖNCESİ bakiyesine döndü", (await cariBalance(tedarikci)).equals(tedBeforeEndorse), `${await cariBalance(tedarikci)}`);
    check("§1c çeki veren cariye dokunulmadı", (await cariBalance(musteri)).equals(musBeforeEndorse));
    check("§1d ⭐ durum ENDORSE'un fromStatus'una (AT_BANK) döndü", h.status === ChequeStatus.AT_BANK, h.status);
    check("§1e endorsedToCariId durum işaretçisi null'a döndü", h.endorsedToCariId === null);
    check("§1f başlık bankası (DEPOSIT) korundu", h.bankAccountId === bank.id);
    const pairs = await reversalPairs(c1, CariTxnSource.CHEQUE_ENDORSE_CANCEL);
    const p = pairs[0];
    check(
      "§1g ⭐ ters satır ALACAK, reversesTxnId ile CHEQUE_ENDORSE BORÇ satırına bağlı",
      pairs.length === 1 && !!p?.reverses && p.reverses.sourceType === CariTxnSource.CHEQUE_ENDORSE &&
        D(p.credit).equals(4000) && D(p.debit).isZero() && D(p.reverses.debit).equals(4000) && p.cariId === tedarikci,
      `adet=${pairs.length}`,
    );
    check(
      "§1h ⭐ orijinal ciro satırı SİLİNMEDİ/DEĞİŞMEDİ",
      (await prisma.cariTransaction.count({ where: { chequeId: c1, sourceType: "CHEQUE_ENDORSE", debit: 4000 } })) === 1,
    );
    check("§1i ters satır BUGÜNE yazıldı", !!p && p.txnDate.getTime() >= startedAt.getTime() - 1000);
    const endorseEv = await latestEvent(c1, ChequeEventType.ENDORSE);
    const cancelEv = await latestEvent(c1, ChequeEventType.ENDORSE_CANCEL);
    check(
      "§1j ⭐ ENDORSE ve ENDORSE_CANCEL satırlarının İKİSİ DE counterCariId taşıyor",
      endorseEv?.counterCariId === tedarikci && cancelEv?.counterCariId === tedarikci,
      `ileri=${endorseEv?.counterCariId ?? "-"} ters=${cancelEv?.counterCariId ?? "-"}`,
    );
    check(
      "§1k olay ENDORSED → AT_BANK, sebep notta",
      cancelEv?.fromStatus === ChequeStatus.ENDORSED && cancelEv?.toStatus === ChequeStatus.AT_BANK && !!cancelEv?.notes,
    );
  }
  {
    const before = await txnCount(c1);
    const again = await expectError(() => chequeService.cancelEndorse(c1, "tekrar"));
    check("§1l ikinci ciro stornosu 409 ve defter kirlenmedi", /ciro stornosu/i.test(again) && (await txnCount(c1)) === before, again.slice(0, 70));
  }
  // Zincir: yeniden ciro (başka cari) → storno yeni satırı tersler, eskisine dokunmaz.
  await chequeService.endorse(c1, { toCariId: tedarikci2 });
  await chequeService.cancelEndorse(c1, "ikinci ciro da yanlış");
  {
    const pairs = await reversalPairs(c1, CariTxnSource.CHEQUE_ENDORSE_CANCEL);
    check(
      "§1m zincir: ikinci storno ikinci cironun satırına bağlı (tedarikçi-2)",
      pairs.length === 2 && pairs[1]?.cariId === tedarikci2 && pairs[1]?.reverses?.cariId === tedarikci2 &&
        pairs[0]?.reversesTxnId !== pairs[1]?.reversesTxnId,
    );
    check("§1n tedarikçi-2 bakiyesi sıfıra döndü", (await cariBalance(tedarikci2)).isZero(), `${await cariBalance(tedarikci2)}`);
  }

  // ── §2 KARŞILIKSIZ STORNOSU (PORTFOLIO'dan) ─────────────────────────────
  const c2 = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 2500, dueDate: due });
  const musAfterReceive = await cariBalance(musteri);
  await chequeService.bounce(c2, { notes: "damga" });
  check("§2a karşılıksız müşteriye BORÇ yazdı (sonda zemini)", (await cariBalance(musteri)).equals(musAfterReceive.plus(2500)));
  await chequeService.cancelBounce(c2, "yanlış çek karşılıksız işaretlendi");
  {
    const h = await header(c2);
    const pairs = await reversalPairs(c2, CariTxnSource.CHEQUE_BOUNCE_CANCEL);
    check("§2b ⭐ müşteri bakiyesi karşılıksız ÖNCESİNE döndü", (await cariBalance(musteri)).equals(musAfterReceive), `${await cariBalance(musteri)}`);
    check("§2c durum PORTFOLIO", h.status === ChequeStatus.PORTFOLIO, h.status);
    check(
      "§2d tek ters satır ALACAK, BOUNCE BORÇ satırına bağlı",
      pairs.length === 1 && D(pairs[0]!.credit).equals(2500) && pairs[0]!.reverses?.sourceType === "CHEQUE_BOUNCE",
    );
    const ev = await latestEvent(c2, ChequeEventType.BOUNCE_CANCEL);
    check("§2e olay BOUNCED → PORTFOLIO, counterCariId boş", ev?.fromStatus === "BOUNCED" && ev?.toStatus === "PORTFOLIO" && ev?.counterCariId === null);
  }

  // ── §3 KARŞILIKSIZ STORNOSU (ENDORSED'dan, iki cari) ────────────────────
  const c3 = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 1500, dueDate: due });
  const mus3 = await cariBalance(musteri);
  const ted3 = await cariBalance(tedarikci);
  await chequeService.endorse(c3, { toCariId: tedarikci });
  const musAfterEndorse = await cariBalance(musteri);
  const tedAfterEndorse = await cariBalance(tedarikci);
  await chequeService.bounce(c3, {});
  await chequeService.cancelBounce(c3, "karşılıksız yanlış çeke girildi");
  {
    const h = await header(c3);
    const pairs = await reversalPairs(c3, CariTxnSource.CHEQUE_BOUNCE_CANCEL);
    const drawer = pairs.find((r) => r.cariId === musteri);
    const endorsee = pairs.find((r) => r.cariId === tedarikci);
    check("§3a ⭐ müşteri ciro SONRASI bakiyesine döndü", (await cariBalance(musteri)).equals(musAfterEndorse), `${await cariBalance(musteri)}`);
    check("§3b ⭐ ciro carisi ciro SONRASI bakiyesine döndü", (await cariBalance(tedarikci)).equals(tedAfterEndorse), `${await cariBalance(tedarikci)}`);
    check("§3c ⭐ iki ters satır, her biri KENDİ carisinin orijinaline bağlı", pairs.length === 2 && drawer?.reverses?.cariId === musteri && endorsee?.reverses?.cariId === tedarikci);
    check(
      "§3d yönler: müşteri ALACAK, ciro carisi BORÇ",
      !!drawer && D(drawer.credit).equals(1500) && !!endorsee && D(endorsee.debit).equals(1500),
    );
    check("§3e durum ENDORSED, ciro carisi başlıkta", h.status === ChequeStatus.ENDORSED && h.endorsedToCariId === tedarikci);
    const ev = await latestEvent(c3, ChequeEventType.BOUNCE_CANCEL);
    check("§3f olay counterCariId = ciro carisi", ev?.counterCariId === tedarikci);
  }
  await chequeService.cancelEndorse(c3, "ciro da yanlıştı");
  check(
    "§3g zincir: ardından ciro stornosu → iki cari ciro ÖNCESİNE döndü",
    (await cariBalance(musteri)).equals(mus3) && (await cariBalance(tedarikci)).equals(ted3) && (await header(c3)).status === "PORTFOLIO",
  );

  // ── §4 İADE STORNOSU ────────────────────────────────────────────────────
  const c4 = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 700, dueDate: due });
  const mus4 = await cariBalance(musteri);
  await chequeService.returnToDrawer(c4, {});
  await chequeService.cancelReturn(c4, "iade yanlış çeke girildi");
  {
    const pairs = await reversalPairs(c4, CariTxnSource.CHEQUE_RETURN_CANCEL);
    check("§4a ⭐ alınan çek: müşteri iade ÖNCESİ bakiyesinde", (await cariBalance(musteri)).equals(mus4), `${await cariBalance(musteri)}`);
    check(
      "§4b ters satır ALACAK, iadenin CHEQUE_CANCEL BORÇ satırına bağlı",
      pairs.length === 1 && D(pairs[0]!.credit).equals(700) && pairs[0]!.reverses?.sourceType === "CHEQUE_CANCEL" && D(pairs[0]!.reverses.debit).equals(700),
    );
    check("§4c durum PORTFOLIO", (await header(c4)).status === "PORTFOLIO");
  }
  await chequeService.cancel(c4, "kayıt hatası");
  check(
    "§4d zincir: storno sonrası iptal ayrı CHEQUE_CANCEL yazar, iade stornosu artık 409",
    (await header(c4)).status === "CANCELLED" &&
      /zaten iptal edildi/i.test(await expectError(() => chequeService.cancelReturn(c4, "x"))) &&
      (await cariBalance(musteri)).equals(mus4.plus(700)),
  );

  const i4 = await newCheque({ kind: "ISSUED", cariId: tedarikci, amount: 900, dueDate: due });
  const ted4 = await cariBalance(tedarikci);
  await chequeService.returnToDrawer(i4, {});
  await chequeService.cancelReturn(i4, "tedarikçi iadesi yanlış girildi");
  {
    const pairs = await reversalPairs(i4, CariTxnSource.CHEQUE_RETURN_CANCEL);
    check("§4e ⭐ verilen çek: tedarikçi iade ÖNCESİ bakiyesinde", (await cariBalance(tedarikci)).equals(ted4), `${await cariBalance(tedarikci)}`);
    check("§4f ters satır BORÇ (verilen çekte iade ALACAK yazmıştı)", pairs.length === 1 && D(pairs[0]!.debit).equals(900) && D(pairs[0]!.reverses!.credit).equals(900));
    check("§4g durum ISSUED", (await header(i4)).status === "ISSUED");
  }

  // ── §5 ÖDEME STORNOSU ───────────────────────────────────────────────────
  const i5 = await newCheque({ kind: "ISSUED", cariId: tedarikci, amount: 3000, dueDate: due });
  const ted5 = await cariBalance(tedarikci);
  const txnsBeforePay = await txnCount(i5);
  await chequeService.pay(i5, { cashBoxId: box.id });
  check("§5a PAY cari deftere satır YAZMADI (kod çapası: pay() writeChequeLedgerTx çağırmaz)", (await txnCount(i5)) === txnsBeforePay);
  check("§5b kasa −3000 (sonda zemini)", (await boxBalance(box.id)).equals(-3000));
  await chequeService.cancelPay(i5, "yanlış çek ödendi işaretlendi");
  {
    const h = await header(i5);
    const ev = await latestEvent(i5, ChequeEventType.PAY_CANCEL);
    check("§5c ⭐ para AYNI kasaya geri girdi", (await boxBalance(box.id)).isZero(), `${await boxBalance(box.id)}`);
    check("§5d ⭐ PAY_CANCEL da cari YAZMADI, tedarikçi bakiyesi aynı", (await txnCount(i5)) === txnsBeforePay && (await cariBalance(tedarikci)).equals(ted5));
    check("§5e durum ISSUED, başlık bankası boş", h.status === "ISSUED" && h.bankAccountId === null);
    check("§5f olay PAID → ISSUED, kasa hesabını taşıyor", ev?.fromStatus === "PAID" && ev?.toStatus === "ISSUED" && ev?.cashBoxId === box.id);
  }
  // Geriye tarihli ikinci ödeme BANKADAN: storno en yeni PAY'i (createdAt) bulmalı.
  await chequeService.pay(i5, { bankAccountId: bank.id, eventDate: new Date(Date.now() - 5 * DAY) });
  check("§5g ikinci ödeme bankadan, başlıkta banka", (await bankBalance(bank.id)).equals(-3000) && (await header(i5)).bankAccountId === bank.id);
  await chequeService.cancelPay(i5, "ikinci ödeme de yanlış");
  check(
    "§5h ⭐ geriye tarihli zincir: para BANKAYA döndü, kasa oynamadı",
    (await bankBalance(bank.id)).isZero() && (await boxBalance(box.id)).isZero(),
    `banka=${await bankBalance(bank.id)} kasa=${await boxBalance(box.id)}`,
  );
  check("§5i bankadan ödeme stornosunda PAY'in damgaladığı başlık bankası geri kalktı", (await header(i5)).bankAccountId === null);

  // ── §6 MUTABAKAT — PAY_CANCEL bakiyeyi okuyan her yüzeyde görünür ────────
  // Kasayı sıfırdan uzak bırak: storno sonrası bir ödeme daha (sıfır = vakum).
  const i6 = await newCheque({ kind: "ISSUED", cariId: tedarikci, amount: 1200, dueDate: due });
  await chequeService.pay(i6, { cashBoxId: box.id });
  await chequeService.cancelPay(i6, "mutabakat sondası");
  await chequeService.pay(i6, { cashBoxId: box.id });
  {
    const stored = await boxBalance(box.id);
    check("§6a zemin: kasa bakiyesi sıfır değil", stored.equals(-1200), `${stored}`);
    const book = await getCashBookReport({ range: { from: new Date(Date.now() - 30 * DAY), to: new Date(Date.now() + DAY) }, accountId: box.id });
    const acc = book.accounts.find((a) => a.accountId === box.id);
    const cancelRows = (book.rows ?? []).filter((r) => r.kind === "PAY_CANCEL");
    check("§6b ⭐ kasa defteri kapanışı saklı bakiyeyle AYNI", !!acc && D(acc.closing).equals(stored), `kapanış=${acc?.closing} saklı=${stored}`);
    check(
      "§6c kasa defterinde PAY_CANCEL satırları GİRİŞ + iptal işaretli",
      cancelRows.length === 2 && cancelRows.every((r) => r.direction === "IN" && r.cancelled),
      `adet=${cancelRows.length}`,
    );
    const pv = await cashPeriodCloseService.preview({ cashBoxId: box.id, periodEnd: todayKey });
    check("§6d ⭐ kasa dönem kapanışı önizlemesi saklı bakiyeyle AYNI", D(pv.data.closingBalance).equals(stored), `önizleme=${pv.data.closingBalance}`);
    const drift = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text AS id FROM cash_boxes c
      LEFT JOIN (
        SELECT e."cashBoxId", SUM(CASE WHEN ${Prisma.raw(chequeCashInflowSql("e"))} THEN ch.amount ELSE -ch.amount END) AS t
          FROM cheque_events e JOIN cheques ch ON ch.id = e."chequeId"
          WHERE e.type IN (${Prisma.raw(chequeCashEventTypesSql())}) AND e."cashBoxId" IS NOT NULL GROUP BY e."cashBoxId"
      ) p ON p."cashBoxId" = c.id
      WHERE c.id = ${box.id}::uuid AND c.balance <> COALESCE(p.t, 0)`;
    check("§6e §23 formülü (tek kaynak) PAY_CANCEL sonrası sapmasız", drift.length === 0, `sapma=${drift.length}`);
  }

  // ── §7 EŞZAMANLI ÇİFT STORNO ────────────────────────────────────────────
  // `Promise.allSettled` MEŞRU: ayrı transaction'lar, tek tx'i paylaşan paralellik değil.
  const c7 = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 600, dueDate: due });
  const mus7 = await cariBalance(musteri);
  await chequeService.bounce(c7, {});
  const results = await Promise.allSettled([
    chequeService.cancelBounce(c7, "yarış-1"),
    chequeService.cancelBounce(c7, "yarış-2"),
  ]);
  check("§7a ⭐ iki eşzamanlı stornodan YALNIZ biri geçti", results.filter((r) => r.status === "fulfilled").length === 1);
  check("§7b tek ters satır", (await prisma.cariTransaction.count({ where: { chequeId: c7, sourceType: "CHEQUE_BOUNCE_CANCEL" } })) === 1);
  check("§7c bakiye tek kez döndü", (await cariBalance(musteri)).equals(mus7), `${await cariBalance(musteri)}`);

  // ── §8 TERS KAYIT BUGÜNE — orijinal kapalı dönemde ──────────────────────
  const kapali = await makeCari("KAPALI");
  const c8 = await newCheque({
    kind: "RECEIVED", cariId: kapali, amount: 800, dueDate: due, postingDate: new Date(Date.now() - 30 * DAY),
  });
  await chequeService.bounce(c8, { eventDate: new Date(Date.now() - 20 * DAY) });
  await prisma.cariPeriodClose.create({
    data: { cariId: kapali, currency: "TRY", periodEnd: periodDayKey(new Date(Date.now() - 10 * DAY)), closingBalance: 0, txnCount: 0 },
    select: { id: true },
  });
  const closedErr = await expectError(() => chequeService.cancelBounce(c8, "kapalı dönemdeki karşılıksız yanlıştı"));
  const rev8 = await reversalPairs(c8, CariTxnSource.CHEQUE_BOUNCE_CANCEL);
  check("§8a ⭐ orijinali kapalı dönemde kalan storno GEÇTİ", closedErr === "", closedErr.slice(0, 80));
  check("§8b ters satır BUGÜNE düştü (kapalı dönem fotoğrafı değişmedi)", rev8.length === 1 && rev8[0]!.txnDate.getTime() >= startedAt.getTime() - 1000);

  // ── §9 KAPILAR ──────────────────────────────────────────────────────────
  const c9 = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 100, dueDate: due });
  check("§9a sebep zorunlu", /sebep zorunlu/i.test(await expectError(() => chequeService.cancelBounce(c9, "  "))));
  check("§9b canlı çekte karşılıksız stornosu 409", /karşılıksız stornosu/i.test(await expectError(() => chequeService.cancelBounce(c9, "x"))));
  check("§9c yön kapısı: alınan çekte ödeme stornosu reddedilir", /ALINAN/i.test(await expectError(() => chequeService.cancelPay(c9, "x"))));
  await chequeService.bounce(c9, {});
  check(
    "§9d terminal mesajı çıkış yolunu gösteriyor (Karşılıksızı Geri Al)",
    /Karşılıksızı Geri Al/.test(await expectError(() => chequeService.bounce(c9, {}))),
  );
  check(
    "§9e ciro edilmiş çekte iptal mesajı ciro stornosunu gösteriyor",
    /Ciroyu Geri Al/.test(
      await expectError(async () => {
        const c = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 50, dueDate: due });
        await chequeService.endorse(c, { toCariId: tedarikci });
        await chequeService.cancel(c, "x");
      }),
    ),
  );

  // ── §10 TEK KAYNAK TRIPWIRE ─────────────────────────────────────────────
  const LITERAL = /\btype"?\s*(?:=|IN)\s*\(?\s*'(?:COLLECT|PAY|DEPOSIT|COLLECT_CANCEL|PAY_CANCEL)'/;
  check("§10a zemin: desen bilinen örneği yakalıyor", LITERAL.test("WHERE e.type IN ('COLLECT', 'PAY')") && LITERAL.test("CASE WHEN e.type = 'COLLECT'"));
  const root = join(__dirname, "..");
  // Muaf: helper (kaynağın kendisi) ve bu dosya (desen örneğini taşır).
  const files = [...listTsFiles(join(root, "src")), ...listTsFiles(join(root, "scripts"))].filter(
    (f) => !f.endsWith("cheque-cash-events.helper.ts") && !f.endsWith("test_cheque_reversal.ts"),
  );
  const offenders = files.filter((f) => LITERAL.test(readFileSync(f, "utf8"))).map((f) => relative(root, f));
  check("§10b zemin: taranan dosya sayısı anlamlı", files.length > 500, `dosya=${files.length}`);
  check("§10c ⭐ çek-olayı para kümesi elle yazılmamış (tek kaynak helper)", offenders.length === 0, offenders.join(", ") || "-");
  const enumValues = Object.values(ChequeEventType).sort();
  check(
    "§10d helper tablosu ChequeEventType ile birebir",
    JSON.stringify(Object.keys(CHEQUE_EVENT_CASH_EFFECT).sort()) === JSON.stringify(enumValues),
  );
  const forwardWithReversal = ["COLLECT", "ENDORSE", "BOUNCE", "RETURN", "PAY", "DEPOSIT"];
  check(
    "§10e her ileri olayın *_CANCEL tersi enum'da",
    forwardWithReversal.every((t) => enumValues.includes(`${t}_CANCEL` as ChequeEventType)),
  );
  const sources = Object.values(CariTxnSource) as string[];
  check(
    "§10f çekin cari yazan ileri kaynaklarının tipli tersi enum'da",
    ["CHEQUE_ENDORSE", "CHEQUE_BOUNCE", "CHEQUE_RETURN"].every((s) => sources.includes(`${s}_CANCEL`)),
  );

  // ── §11 BANKAYA VERME STORNOSU ──────────────────────────────────────────
  const c11 = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 700, dueDate: due });
  const bank11 = await prisma.bankAccount.create({ data: { code: `${TAG}-BN2`, name: `${TAG} Banka 2`, currency: "TRY" }, select: { id: true } });
  bankIds.push(bank11.id);
  await chequeService.deposit(c11, { bankAccountId: bank.id });
  const bankBefore11 = await bankBalance(bank.id);
  const txnsBefore11 = await txnCount(c11);
  const depositBefore11 = await prisma.chequeEvent.findFirst({ where: { chequeId: c11, type: ChequeEventType.DEPOSIT }, select: { id: true, bankAccountId: true, toStatus: true } });
  check("§11a zemin: bankaya verildi, başlıkta banka", (await header(c11)).status === "AT_BANK" && (await header(c11)).bankAccountId === bank.id);
  const r11 = await chequeService.cancelDeposit(c11, "yanlış bankaya verildi");
  {
    const h = await header(c11);
    const ev = await latestEvent(c11, ChequeEventType.DEPOSIT_CANCEL);
    check("§11b ⭐ durum PORTFOLIO, başlık bankası DÜŞTÜ", h.status === "PORTFOLIO" && h.bankAccountId === null, `${h.status}/${h.bankAccountId}`);
    check("§11c ⭐ banka bakiyesi OKUNARAK değişmedi (sign:0 sabitine güvenilmedi)", (await bankBalance(bank.id)).equals(bankBefore11), `${bankBefore11} → ${await bankBalance(bank.id)}`);
    check("§11d olay AT_BANK → PORTFOLIO, hangi bankadan geri alındığını taşıyor, sebep notta", ev?.fromStatus === "AT_BANK" && ev?.toStatus === "PORTFOLIO" && ev?.bankAccountId === bank.id && ev?.notes === "yanlış bankaya verildi");
    const depositAfter = await prisma.chequeEvent.findUnique({ where: { id: depositBefore11!.id }, select: { bankAccountId: true, toStatus: true } });
    check("§11e ileri DEPOSIT satırı NE SİLİNDİ NE DEĞİŞTİ", depositAfter?.bankAccountId === depositBefore11?.bankAccountId && depositAfter?.toStatus === depositBefore11?.toStatus);
    check("§11f cari deftere satır yazılmadı (DEPOSIT de yazmamıştı)", (await txnCount(c11)) === txnsBefore11);
    const evDate = await prisma.chequeEvent.findFirst({ where: { chequeId: c11, type: ChequeEventType.DEPOSIT_CANCEL }, select: { eventDate: true } });
    check("§11h ters kayıt BUGÜNE", evDate != null && evDate.eventDate.getTime() >= startedAt.getTime() - 1000);
    check("§11i mesaj durumu adıyla söylüyor", /portföyde/i.test(r11.message ?? "") && /para oynamadı/i.test(r11.message ?? ""));
  }
  check("§11g sebep zorunlu", /sebep zorunlu/i.test(await expectError(() => chequeService.cancelDeposit(c11, "  "))));
  check("§11j ikinci storno 409 (çek artık portföyde)", /portföyde/i.test(await expectError(() => chequeService.cancelDeposit(c11, "x"))));
  await chequeService.deposit(c11, { bankAccountId: bank11.id });
  check("§11k yeniden bankaya verilebilir (başka bankaya)", (await header(c11)).status === "AT_BANK" && (await header(c11)).bankAccountId === bank11.id);
  await chequeService.collect(c11, { bankAccountId: bank11.id });
  check("§11l ⭐ tahsil edilmiş çekte storno 409 — yol tahsil stornosu", /Tahsilatı Geri Al/.test(await expectError(() => chequeService.cancelDeposit(c11, "x"))));
  await chequeService.cancelCollect(c11, "tahsil yanlış");
  check("§11m COLLECT_CANCEL çeki AT_BANK'a döndürdü (bank11)", (await header(c11)).status === "AT_BANK" && (await header(c11)).bankAccountId === bank11.id);
  await chequeService.cancelDeposit(c11, "bankaya verme de yanlıştı");
  {
    const h = await header(c11);
    const ev = await latestEvent(c11, ChequeEventType.DEPOSIT_CANCEL);
    check("§11n ⭐ COLLECT_CANCEL sonrası storno MEŞRU: en yeni DEPOSIT (bank11) geri alındı, portföyde", h.status === "PORTFOLIO" && h.bankAccountId === null && ev?.bankAccountId === bank11.id);
    check("§11o iki bankanın bakiyesi de sıfır (tahsil + stornosu net 0, deposit'ler oynatmadı)", (await bankBalance(bank11.id)).isZero() && (await bankBalance(bank.id)).equals(bankBefore11));
  }
  check("§11p yön kapısı: verilen çekte bankaya verme stornosu reddedilir", /VERDİĞİMİZ/.test(await expectError(async () => {
    const i = await newCheque({ kind: "ISSUED", cariId: tedarikci, amount: 10, dueDate: due });
    await chequeService.cancelDeposit(i, "x");
  })));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // FK sırası: ters satır orijinaline RESTRICT ile bağlı → önce ters satırlar.
    const stray = cariIds.length
      ? await prisma.cheque.findMany({ where: { cariId: { in: cariIds } }, select: { id: true } })
      : [];
    const allCheques = [...new Set([...chequeIds, ...stray.map((c) => c.id)])];
    if (allCheques.length) {
      await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: allCheques } } });
      await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: allCheques }, reversesTxnId: { not: null } } });
      await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: allCheques } } });
      await prisma.cheque.deleteMany({ where: { id: { in: allCheques } } });
    }
    if (cariIds.length) {
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariPeriodClose.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    if (cashBoxIds.length) await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
    if (bankIds.length) await prisma.bankAccount.deleteMany({ where: { id: { in: bankIds } } });
    if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
