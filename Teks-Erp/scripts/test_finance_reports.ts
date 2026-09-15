// =============================================================================
// BEKÇİ — ÖN MUHASEBE RAPORLARI: yaşlandırma · kasa defteri · rejim kapısı
// =============================================================================
// Çalıştırma: npx tsx scripts/test_finance_reports.ts
//
// NEDEN: Yaşlandırma, cari bakiyesini İKİNCİ BİR YOLDAN yeniden üretir. Sol
// taraf BELGE tablolarından (`invoices` / `payments`), sağ taraf DEFTERDEN
// (`cari_transactions`) gelir. İki yol ayrışırsa raporlardan biri yalan
// söylüyordur ve bu, hata da log da çıkarmadan olur — ay sonunda müşteriyle
// rakam tutmaz. Bu dosyanın en değerli kontrolü o eşitliktir:
//
//     Σ(kovalar) − kapanmamış kredi = CariBalance
//
// ÖLÇÜLENLER:
//   §1  KOVA SINIRLARI — 30/31 · 60/61 · 90/91 gün geçişleri tek tek
//   §2  VADESİZ ≠ VADESİ GELMEMİŞ; efektif vade cari vade gününden TÜRER
//   §3  ⭐ BÜYÜK MUTABAKAT (tüm cariler) + denormalize sayaç sapması
//   §4  SANAL FIFO MAHSUP — en eski vadeden başlar, GROSS'a dokunmaz
//   §5  FAZLA TAHSİLAT — kapanmamış kredi olarak durur, mutabakat bozulmaz
//   §6  ÇEK: kredi DEFTERDEN okunur → karşılıksızda kredi kendiliğinden düşer
//   §7  asOf KESİTİ — kesitten sonraki belge/tahsilat rapora GİRMEZ
//   §8  PARA BİRİMİ AYRI BLOK + kur yoksa TL karşılığı BASILMAZ
//   §9  KASA DEFTERİ — üç yazar (tahsilat · kasa hareketi · çek COLLECT),
//       devir hareketlerden türer, iptal İKİ satır, DEPOSIT deftere GİRMEZ
//   §10 REJİM KAPISI — rapor uçları `requireFinanceEnabled` + `report:finance`
//   §11 ⭐ TEK KAYNAK (H1+H2, 2026-08-14): cari LİSTESİNİN "Gecikmiş" toplamı
//       = yaşlandırmanın `overdueTotal`'ı, AYNI fixture üzerinde BİREBİR
//       (sanal FIFO mahsup + cari-vade-günü türetimi DAHİL — naif
//       "grandTotal−paidTotal WHERE due<now" formülü burada KIRMIZI verir);
//       fatura LIST_SELECT'i `paidTotal` taşır; bayraksız listede `overdue`
//       alanı HİÇ yoktur + kaynak taraması (guard `params.withOverdue` içinde,
//       cari.service kendi gecikme SQL'ini yazmaz, rapor da çekirdekten okur).
//   §12 ⭐ KASA KATEGORİ KIRILIMI (H7, 2026-08-14): kasa hareketi KENDİ serbest
//       kategorisiyle, carili tahsilat/ödeme ve çek olayı ise kategori alanları
//       OLMADIĞI için tek kovada; virman da (uç kategori kabul etmiyor) ayrı
//       kovada. Asıl kontrol MUTABAKAT: Σ kova giren/çıkan = dönem giren/çıkan
//       (hem tek hesapta hem TÜM hesaplarda, PARA BİRİMİ bazında). İkinci
//       kontrol: iptal çifti aynı kovada NETLEŞİR (ters satır aslının
//       kategorisini taşır) — netleşme bozulsa toplam yine tutar, yani onu
//       yalnız bu kontrol yakalar.
//
// KÖRLÜK ZEMİNİ: her bölümün başında "fixture gerçekten oluştu mu" kontrolü
// vardır. Aksi halde "sapma bulunamadı" ile "hiçbir şeye bakılmadı" AYNI yeşile
// çıkar — bu bekçinin en kolay kaybedilecek özelliği budur.
//
// NEGATİF SONDA (§11, 2026-08-14 — üçü de boz→ölç→geri yükle tek zincirde,
// shasum ile birebir geri yükleme kanıtlandı):
//   ① `cari.service` overdue eşlemesi `ar.overdueTotal` yerine `ar.openTotal`
//      okuyacak şekilde bozuldu (formül ayrıştırma) → §11g + §11k kırmızı
//      (liste=5100.00 aging=3400.00 — FIFO farkı yakalandı), exit 1.
//   ② `if (params.withOverdue && ...)` kapısı kaldırıldı (koşulsuz çağrı) →
//      §11l + §11n kırmızı, exit 1.
//   ③ `invoice.service` LIST_SELECT'ten `paidTotal` düşürüldü → §11b + §11c
//      kırmızı, exit 1. (İlk yazımda §11c Decimal("undefined") ile ÇÖKÜYOR ve
//      Sonuç satırı basılmadan suite ölüyordu — `!= null` kapısı bu yüzden var.)
// =============================================================================
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { chequeService } from "../src/services/cheque.service";
import { getAgingReport, bucketOfDaysOverdue, type AgingCariRow } from "../src/services/reports/finance-aging.report";
import { getCashBookReport } from "../src/services/reports/cash-book.report";
import { cariService } from "../src/services/cari.service";
import { paymentAllocationService } from "../src/services/payment-allocation.service";

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

const TAG = `TEST-FINREP-${Date.now()}`;
const DAY = 86_400_000;
const NOW = new Date();
const ago = (d: number): Date => new Date(NOW.getTime() - d * DAY);
const ahead = (d: number): Date => new Date(NOW.getTime() + d * DAY);

const customerIds: string[] = [];
const subcontractorIds: string[] = [];
const cariIds: string[] = [];
const invoiceIds: string[] = [];
const paymentIds: string[] = [];
const chequeIds: string[] = [];
const cashTxnIds: string[] = [];
let cashBoxId = "";
let bankAccountId = "";
/** §12 virman fixture'ının iki ek banka hesabı — temizlikte de ayrıca geçer. */
const extraBankIds: string[] = [];
let usdRateCreated = false;

/** Tek satırlık, KDV'siz fatura — grandTotal tam olarak `amount` olur. */
function lines(amount: number): Array<{ description: string; qty: number; unit: string; unitPrice: number }> {
  return [{ description: "Bekçi kalemi", qty: 1, unit: "m", unitPrice: amount }];
}

async function newCustomer(suffix: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}` },
    select: { id: true },
  });
  customerIds.push(c.id);
  return c.id;
}

async function cariOfCustomer(customerId: string): Promise<string> {
  const c = await prisma.cariAccount.findFirstOrThrow({ where: { customerId }, select: { id: true } });
  if (!cariIds.includes(c.id)) cariIds.push(c.id);
  return c.id;
}

/** Onaylanmış satış faturası üretir ve id'yi temizlik listesine yazar. */
async function sales(
  customerId: string,
  amount: number,
  opts: { issueDate: Date; dueDate?: Date | null; currency?: "TRY" | "USD" | "GBP"; exchangeRate?: number },
): Promise<string> {
  const d = await invoiceService.createDraft({
    type: "SALES",
    customerId,
    currency: opts.currency ?? "TRY",
    exchangeRate: opts.exchangeRate ?? null,
    issueDate: opts.issueDate,
    dueDate: opts.dueDate ?? null,
    lines: lines(amount),
  });
  invoiceIds.push(d.data.id);
  await invoiceService.confirm(d.data.id);
  return d.data.id;
}

function rowOf(rows: AgingCariRow[], cariId: string, currency = "TRY"): AgingCariRow | undefined {
  return rows.find((r) => r.cariId === cariId && r.currency === currency);
}
function allRows(blocks: Array<{ rows: AgingCariRow[] }>): AgingCariRow[] {
  return blocks.flatMap((b) => b.rows);
}

async function main(): Promise<void> {
  console.log("=== Ön muhasebe raporları bekçisi ===\n");

  // ── SAF KOVA EŞLEMESİ (fixture'sız, sınırların kendisi) ───────────────────
  // Sınırlar tek kaynaktan (`bucketOfDaysOverdue`) okunur; fixture'lı kontroller
  // aynı sınırların UÇTAN UCA da uygulandığını gösterir.
  check("§1a −1 gün → vadesi gelmemiş", bucketOfDaysOverdue(-1) === "notDue");
  check("§1b 0 gün → 0-30", bucketOfDaysOverdue(0) === "d0_30");
  check("§1c 30 gün → 0-30 (sınır)", bucketOfDaysOverdue(30) === "d0_30");
  check("§1d 31 gün → 31-60 (sınır)", bucketOfDaysOverdue(31) === "d31_60");
  check("§1e 60/61 gün → 31-60 / 61-90", bucketOfDaysOverdue(60) === "d31_60" && bucketOfDaysOverdue(61) === "d61_90");
  check("§1f 90/91 gün → 61-90 / 90+", bucketOfDaysOverdue(90) === "d61_90" && bucketOfDaysOverdue(91) === "d90plus");
  check("§1g vade YOK → vadesiz (uydurma vade basılmaz)", bucketOfDaysOverdue(null) === "noDueDate");

  // ── FIXTURE ───────────────────────────────────────────────────────────────
  const custA = await newCustomer("A");
  const custB = await newCustomer("B");
  const custC = await newCustomer("C");
  const custD = await newCustomer("D");

  // A: vade günü YOK → vadesiz fatura gerçekten vadesiz kalsın.
  const PLAN: Array<{ due: number | null; amount: number; bucket: string }> = [
    { due: -100, amount: 1000, bucket: "d90plus" },
    { due: -91, amount: 100, bucket: "d90plus" },
    { due: -90, amount: 200, bucket: "d61_90" },
    { due: -61, amount: 300, bucket: "d61_90" },
    { due: -60, amount: 400, bucket: "d31_60" },
    { due: -31, amount: 500, bucket: "d31_60" },
    { due: -30, amount: 600, bucket: "d0_30" },
    { due: 0, amount: 700, bucket: "d0_30" },
    { due: 20, amount: 800, bucket: "notDue" },
    { due: null, amount: 900, bucket: "noDueDate" },
  ];
  for (const p of PLAN) {
    await sales(custA, p.amount, {
      issueDate: ago(120),
      dueDate: p.due === null ? null : p.due >= 0 ? ahead(p.due) : ago(-p.due),
    });
  }
  const cariA = await cariOfCustomer(custA);

  // Döviz bloğu — kur DAMGASI elle verilir (geçmiş tarihli kur satırı aramasın),
  // TL karşılığı için BUGÜNE kur satırı ayrıca yazılır.
  const existingUsd = await prisma.exchangeRate.findFirst({
    where: { currency: "USD", rateDate: { lte: new Date() } },
    select: { id: true },
  });
  if (!existingUsd) {
    await prisma.exchangeRate.create({
      data: { rateDate: new Date(), currency: "USD", rate: new Prisma.Decimal("40") },
    });
    usdRateCreated = true;
  }
  await sales(custA, 250, { issueDate: ago(120), dueDate: ago(10), currency: "USD", exchangeRate: 40 });
  // GBP: kur DAMGASI var (belge kendi kuruyla donar) ama kur TABLOSUNDA satır
  // aranmayacak — "kur yoksa TL karşılığı basılmaz" dalının fixture'ı.
  await sales(custA, 100, { issueDate: ago(120), dueDate: ago(10), currency: "GBP", exchangeRate: 45 });

  // B: cari VADE GÜNÜ 30 → belgesinde vade olmayan fatura ondan türetir.
  const invB1 = await invoiceService.createDraft({
    type: "SALES",
    customerId: custB,
    issueDate: ago(45),
    lines: lines(1000),
  });
  invoiceIds.push(invB1.data.id);
  await invoiceService.confirm(invB1.data.id);
  const cariB = await cariOfCustomer(custB);
  await prisma.cariAccount.update({ where: { id: cariB }, data: { paymentTermDays: 30 } });
  // Kesit testinin belgesi: DÜN kesilmiş → 5 gün önceki kesitte GÖRÜNMEMELİ.
  await sales(custB, 50, { issueDate: ago(2), dueDate: ahead(10) });

  // C: çek senaryosu.
  await sales(custC, 1000, { issueDate: ago(20), dueDate: ago(5) });
  const cariC = await cariOfCustomer(custC);

  // ── §1 KOVA SINIRLARI (uçtan uca) ─────────────────────────────────────────
  const rep1 = await getAgingReport({ asOf: new Date(), includeDetail: true, cariId: cariA });
  const a1 = rowOf(allRows(rep1.blocks), cariA);
  check("§1h KÖRLÜK ZEMİNİ: A carisi raporda var", Boolean(a1), a1 ? `openTotal=${a1.openTotal}` : "YOK");
  if (!a1) throw new Error("Fixture kurulmadı — devam etmek anlamsız.");

  check("§1i 90+ kovası = 1100", a1.gross.d90plus === "1100.00", a1.gross.d90plus);
  check("§1j 61-90 kovası = 500", a1.gross.d61_90 === "500.00", a1.gross.d61_90);
  check("§1k 31-60 kovası = 900", a1.gross.d31_60 === "900.00", a1.gross.d31_60);
  check("§1l 0-30 kovası = 1300", a1.gross.d0_30 === "1300.00", a1.gross.d0_30);
  check("§1m Vadesi gelmemiş = 800 (gecikme kovasına DÜŞMEDİ)", a1.gross.notDue === "800.00", a1.gross.notDue);
  check("§1n Vadesiz = 900 (ayrı kova)", a1.gross.noDueDate === "900.00", a1.gross.noDueDate);
  check("§1o Toplam açık = 5500", a1.openTotal === "5500.00", a1.openTotal);
  check("§1p Tahsilat yokken sanal mahsup SIFIR", a1.virtualOffset === "0.00", a1.virtualOffset);

  // ── §2 VADE KAYNAĞI ───────────────────────────────────────────────────────
  const rep2 = await getAgingReport({ asOf: new Date(), cariId: cariB, includeDetail: true });
  const b2 = rowOf(allRows(rep2.blocks), cariB);
  check("§2a KÖRLÜK ZEMİNİ: B carisi ve kalemleri var", Boolean(b2?.items?.length), `kalem=${b2?.items?.length ?? 0}`);
  const derived = b2?.items?.find((i) => i.grandTotal === "1000.00");
  check("§2b Belgede vade yokken cari VADE GÜNÜNDEN türetildi", derived?.dueSource === "PAYMENT_TERM", derived?.dueSource);
  check(
    "§2c Efektif vade = fatura tarihi + 30 gün",
    derived?.effectiveDueDate
      ? Math.abs(new Date(derived.effectiveDueDate).getTime() - new Date(derived.issueDate).getTime() - 30 * DAY) < 1000
      : false,
    derived?.effectiveDueDate ?? "—",
  );
  check("§2d Türetilmiş vade 0-30 kovasında", derived?.bucket === "d0_30", derived?.bucket);
  const undated = a1.items?.find((i) => i.grandTotal === "900.00");
  check("§2e Vade günü OLMAYAN caride uydurma vade YOK", undated?.dueSource === "NONE" && undated.effectiveDueDate === null);

  // ── HESAPLAR + PARA HAREKETLERİ ───────────────────────────────────────────
  const cashBox = await prisma.cashBox.create({
    data: { code: `${TAG}-KS`, name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxId = cashBox.id;
  const bank = await prisma.bankAccount.create({
    data: { code: `${TAG}-BN`, name: `${TAG} Banka`, currency: "TRY" },
    select: { id: true },
  });
  bankAccountId = bank.id;

  const payA = await paymentService.create({
    direction: "IN",
    method: "CASH",
    customerId: custA,
    amount: 400,
    cashBoxId,
    paymentDate: ago(10),
  });
  paymentIds.push(payA.data.id);

  const payB = await paymentService.create({
    direction: "IN",
    method: "CASH",
    customerId: custB,
    amount: 1200,
    cashBoxId,
  });
  paymentIds.push(payB.data.id);

  // İptal edilecek ödeme — defterde İKİ satır üretmeli (asıl + ters).
  const sub = await prisma.subcontractor.create({
    data: { code: `${TAG}-F`, name: `${TAG} Fason` },
    select: { id: true },
  });
  subcontractorIds.push(sub.id);
  const payCancelled = await paymentService.create({
    direction: "OUT",
    method: "CASH",
    subcontractorId: sub.id,
    amount: 200,
    cashBoxId,
    paymentDate: ago(8),
  });
  paymentIds.push(payCancelled.data.id);
  cariIds.push((await prisma.cariAccount.findFirstOrThrow({ where: { subcontractorId: sub.id }, select: { id: true } })).id);
  await paymentService.cancel(payCancelled.data.id, "bekçi iptali");

  const expense = await cashTransactionService.create({
    kind: "EXPENSE",
    cashBoxId,
    amount: 300,
    txnDate: ago(5),
    category: "Kira",
    description: `${TAG} gider`,
  });
  cashTxnIds.push(expense.data.id);

  // ── §4/§5 SANAL FIFO + FAZLA TAHSİLAT ─────────────────────────────────────
  const rep3 = await getAgingReport({ asOf: new Date(), includeDetail: false });
  const a3 = rowOf(allRows(rep3.blocks), cariA);
  const b3 = rowOf(allRows(rep3.blocks), cariB);
  check("§4a KÖRLÜK ZEMİNİ: A ve B satırları var", Boolean(a3 && b3));
  if (!a3 || !b3) throw new Error("Satırlar bulunamadı.");

  check("§4b GROSS kovalar DEĞİŞMEDİ (mahsup sanal)", a3.gross.d90plus === "1100.00", a3.gross.d90plus);
  check("§4c Sanal mahsup EN ESKİ vadeden başladı (90+ net 700)", a3.net.d90plus === "700.00", a3.net.d90plus);
  check("§4d Diğer kovalara dokunulmadı", a3.net.d61_90 === "500.00" && a3.net.d0_30 === "1300.00");
  check("§4e Mahsup toplamı = tahsilat", a3.virtualOffset === "400.00", a3.virtualOffset);
  check("§4f Açık toplam 400 azaldı", a3.openTotal === "5100.00", a3.openTotal);
  check("§4g Kapanmamış kredi kalmadı", a3.unappliedCredit === "0.00", a3.unappliedCredit);

  check("§5a Fazla tahsilatta tüm kovalar kapandı", b3.openTotal === "0.00", b3.openTotal);
  check("§5b Artan kredi kapanmamış olarak duruyor", b3.unappliedCredit === "150.00", b3.unappliedCredit);
  check("§5c Bakiye negatif (avans)", b3.ledgerBalance === "-150.00", b3.ledgerBalance);
  check("§5d Fazla tahsilatta da mutabakat SIFIR", b3.reconDiff === "0.00", b3.reconDiff);

  // ── §6 ÇEK — KREDİ DEFTERDEN OKUNUR ───────────────────────────────────────
  const chq = await chequeService.create({
    kind: "RECEIVED",
    customerId: custC,
    amount: 1000,
    issueDate: ago(3),
    dueDate: ahead(30),
    serialNo: `${TAG}-CK1`,
  });
  chequeIds.push(chq.data.id);

  const rep4 = await getAgingReport({ asOf: new Date(), cariId: cariC });
  const c4 = rowOf(allRows(rep4.blocks), cariC);
  check("§6a KÖRLÜK ZEMİNİ: C carisi raporda", Boolean(c4));
  check("§6b Çek alındı → fatura sanal mahsupla kapandı", c4?.openTotal === "0.00", c4?.openTotal ?? "—");
  check("§6c Çek kredisi tam kullanıldı", c4?.virtualOffset === "1000.00", c4?.virtualOffset ?? "—");
  check("§6d Çekli caride mutabakat SIFIR", c4?.reconDiff === "0.00", c4?.reconDiff ?? "—");

  await chequeService.bounce(chq.data.id, { notes: "bekçi" });
  const rep5 = await getAgingReport({ asOf: new Date(), cariId: cariC });
  const c5 = rowOf(allRows(rep5.blocks), cariC);
  check(
    "§6e KARŞILIKSIZ: kredi kendiliğinden düştü, fatura yeniden AÇIK",
    c5?.openTotal === "1000.00" && c5.virtualOffset === "0.00",
    `open=${c5?.openTotal} offset=${c5?.virtualOffset}`,
  );
  check("§6f Karşılıksız sonrası mutabakat SIFIR", c5?.reconDiff === "0.00", c5?.reconDiff ?? "—");

  // Kasa defterinin çek ayağı — AYRI cari (yukarıdaki beklentileri kirletmesin).
  const chq2 = await chequeService.create({
    kind: "RECEIVED",
    customerId: custD,
    amount: 500,
    issueDate: ago(2),
    dueDate: ahead(15),
    serialNo: `${TAG}-CK2`,
  });
  chequeIds.push(chq2.data.id);
  await cariOfCustomer(custD);
  await chequeService.deposit(chq2.data.id, { bankAccountId });
  await chequeService.collect(chq2.data.id, { bankAccountId });

  // ── §3 BÜYÜK MUTABAKAT (TÜM CARİLER) ──────────────────────────────────────
  const repAll = await getAgingReport({ asOf: new Date() });
  const rows = allRows(repAll.blocks);
  check("§3a KÖRLÜK ZEMİNİ: mutabakat gerçekten satır gördü", repAll.reconciliation.rowsChecked >= 5, `satır=${repAll.reconciliation.rowsChecked}`);
  check(
    "§3b ⭐ Σ(kovalar) − kapanmamış kredi = CariBalance (TÜM cariler)",
    repAll.reconciliation.mismatchedRows === 0,
    repAll.reconciliation.mismatchedRows > 0
      ? `SAPMA: ${repAll.reconciliation.samples.map((s) => `${s.name}/${s.currency}=${s.diff}`).join(", ")}`
      : "sapma yok",
  );
  const storedDrift = rows.filter((r) => r.storedDiff !== null && r.storedDiff !== "0.00");
  check(
    "§3c Defter toplamı = denormalize CariBalance",
    storedDrift.length === 0,
    storedDrift.map((r) => `${r.name}=${r.storedDiff}`).join(", ") || "sapma yok",
  );
  check(
    "§3d Kapama sayaçları (paidTotal / allocatedTotal) allocation'larla tutuyor",
    repAll.reconciliation.allocationDriftInvoices === 0 && repAll.reconciliation.allocationDriftPayments === 0,
    `fatura=${repAll.reconciliation.allocationDriftInvoices} tahsilat=${repAll.reconciliation.allocationDriftPayments}`,
  );
  // Elle, ikinci bir yoldan: A carisinin bakiyesi ile kova toplamı.
  const balA = await prisma.cariBalance.findUniqueOrThrow({
    where: { cariId_currency: { cariId: cariA, currency: "TRY" } },
    select: { balance: true },
  });
  const aAll = rowOf(rows, cariA);
  check(
    "§3e A carisi: kova toplamı − kredi = kayıtlı bakiye",
    aAll ? new Prisma.Decimal(aAll.openTotal).minus(aAll.unappliedCredit).equals(new Prisma.Decimal(balA.balance)) : false,
    `${aAll?.openTotal} − ${aAll?.unappliedCredit} vs ${balA.balance.toString()}`,
  );

  // ── §7 asOf KESİTİ ────────────────────────────────────────────────────────
  const repCut = await getAgingReport({ asOf: ago(5), cariId: cariB, includeDetail: true });
  const bCut = rowOf(allRows(repCut.blocks), cariB);
  check("§7a KÖRLÜK ZEMİNİ: kesitte B carisi hâlâ var", Boolean(bCut), bCut?.openTotal ?? "YOK");
  check("§7b Kesitten SONRA kesilen fatura rapora girmedi", bCut?.items?.every((i) => i.grandTotal !== "50.00") ?? false);
  check("§7c Kesitten SONRA yapılan tahsilat rapora girmedi", bCut?.openTotal === "1000.00", bCut?.openTotal ?? "—");
  check("§7d Kesitte kredi de yok", bCut?.unappliedCredit === "0.00", bCut?.unappliedCredit ?? "—");
  check("§7e Kesitte de mutabakat SIFIR (defter aynı kesitle toplandı)", bCut?.reconDiff === "0.00", bCut?.reconDiff ?? "—");

  // ── §8 PARA BİRİMİ BLOKLARI ───────────────────────────────────────────────
  const repCur = await getAgingReport({ asOf: new Date(), cariId: cariA });
  const tryBlock = repCur.blocks.find((b) => b.currency === "TRY");
  const usdBlock = repCur.blocks.find((b) => b.currency === "USD");
  check("§8a İki para birimi AYRI blokta", Boolean(tryBlock && usdBlock));
  check("§8b USD tutarı TL bloğuna KARIŞMADI", tryBlock?.totals.openTotal === "5100.00", tryBlock?.totals.openTotal ?? "—");
  check("§8c USD bloğu kendi tutarını taşıyor", usdBlock?.totals.openTotal === "250.00", usdBlock?.totals.openTotal ?? "—");
  check("§8d TL karşılığı rapor günü kuruyla hesaplandı", usdBlock?.totalsTry !== null && usdBlock?.tryRate !== null, usdBlock?.tryRate ?? "—");
  check(
    "§8e TL karşılığı = tutar × kur",
    usdBlock?.totalsTry
      ? new Prisma.Decimal(usdBlock.totals.openTotal)
          .mul(new Prisma.Decimal(usdBlock.tryRate ?? 0))
          .toFixed(2) === usdBlock.totalsTry.openTotal
      : false,
    usdBlock?.totalsTry?.openTotal ?? "—",
  );
  check("§8f TRY bloğunda kur satırı ARANMADI (kur 1)", tryBlock?.tryRate === "1.000000", tryBlock?.tryRate ?? "—");

  // KUR YOKSA TL KARŞILIĞI BASILMAZ.
  // ⚠️ Ortamdaki veriye BAĞIMLI OLMAMAK için GBP kurları ölçüm süresince
  // SAKLANIR ve hemen geri yazılır: "bu para biriminin kuru yoktur" varsayımını
  // ortama emanet etmek, kuru olan bir kurulumda kontrolü SESSİZCE yeşile
  // çevirirdi (fabrika kataloğuna gerçekten eklenebilecek bir kodu sonda olarak
  // kullanma yasağının aynısı).
  const hiddenGbp = await prisma.exchangeRate.findMany({ where: { currency: "GBP" } });
  await prisma.exchangeRate.deleteMany({ where: { id: { in: hiddenGbp.map((r) => r.id) } } });
  try {
    const repNoRate = await getAgingReport({ asOf: new Date(), cariId: cariA, currency: "GBP" });
    const gbp = repNoRate.blocks.find((b) => b.currency === "GBP");
    check("§8g KÖRLÜK ZEMİNİ: GBP bloğu üretildi", Boolean(gbp), gbp?.totals.openTotal ?? "YOK");
    check("§8h GBP açık tutarı doğru", gbp?.totals.openTotal === "100.00", gbp?.totals.openTotal ?? "—");
    check("§8i Kur bulunamayınca TL karşılığı BASILMADI (uydurma kur yok)", gbp?.totalsTry === null && gbp?.tryRate === null);
    check(
      "§8j Kur yokluğu DİPNOTLA söylendi",
      repNoRate.notes.some((n) => n.includes("GBP") && n.includes("kur")),
      repNoRate.notes.find((n) => n.includes("GBP")) ?? "—",
    );
  } finally {
    for (const r of hiddenGbp) {
      await prisma.exchangeRate.create({
        data: {
          rateDate: r.rateDate,
          currency: r.currency,
          rate: r.rate,
          source: r.source,
          createdById: r.createdById,
        },
      });
    }
  }

  // ── §11 TEK KAYNAK: CARİ LİSTESİ "GECİKMİŞ" = AGING overdueTotal (H1+H2) ──
  // Cari listesinin "Gecikmiş" kolonu yaşlandırmanın ÇEKİRDEĞİNDEN
  // (`collectAgingRows`) okur — iki yüzey AYNI fixture üzerinde BİREBİR aynı
  // rakamı basmak zorundadır. Fixture bilinçli olarak iki tuzağı da içerir:
  //   • cariA: kapanmamış 400 TL tahsilat → SANAL FIFO mahsup gecikmişi
  //     3800'den 3400'e düşürür (naif "grand−paid WHERE due<now" 3800 derdi);
  //   • cariB: vade CARİ VADE GÜNÜNDEN türer + fazla tahsilat her şeyi kapatır
  //     → gecikmiş 0 (naif formül 700 derdi — vade türetimi + FIFO ikisi birden).
  // Formül tek tarafta değişirse (sonda ①) eşitlik burada kırmızı verir.

  // H1 fixture'ı: GERÇEK bir kapama — LIST_SELECT'in `paidTotal` taşıdığını
  // sıfırdan farklı bir değerle kanıtlar (0, "alan var" ile "alan yok"u ayırt
  // edemezdi). Allocation deftere satır yazmadığı için §9 kasa beklentilerine
  // dokunmaz.
  await paymentAllocationService.allocate({ invoiceId: invB1.data.id, paymentId: payB.data.id, amount: 300 });
  const invList = await invoiceService.list({ cariId: cariB, pageSize: 50 });
  const invB1Row = invList.data.find((r) => r.id === invB1.data.id);
  check("§11a KÖRLÜK ZEMİNİ: fatura listesi invB1'i döndü", Boolean(invB1Row), invB1Row?.docNo ?? "YOK");
  check(
    "§11b Fatura listesi `paidTotal` taşıyor (H1 — rozet türetiminin ham girdisi)",
    invB1Row !== undefined && "paidTotal" in invB1Row && invB1Row.paidTotal !== undefined,
  );
  // ⚠️ `paidTotal != null` kapısı ÇÖKMEYE karşı: alan LIST_SELECT'ten
  // düşürülürse Decimal("undefined") fırlatır ve suite Sonuç satırı basılmadan
  // ölürdü — kırmızı yerine yarım koşum (negatif sonda ③'te ölçüldü).
  check(
    "§11c paidTotal gerçek kapamayı yansıtıyor (300)",
    invB1Row?.paidTotal != null && new Prisma.Decimal(String(invB1Row.paidTotal)).toFixed(2) === "300.00",
    invB1Row ? String(invB1Row.paidTotal) : "—",
  );
  check(
    "§11d dueDate + grandTotal da listede (türetim için üçü birlikte gerekli)",
    invB1Row !== undefined && "dueDate" in invB1Row && "grandTotal" in invB1Row,
  );

  // ── EŞİTLİK: iki yüzey aynı anda okunur (arada fixture değişmez) ──────────
  const clOn = await cariService.list({ search: TAG, pageSize: 200, withOverdue: true });
  const repFinal = await getAgingReport({ asOf: new Date() });
  const agingFinal = allRows(repFinal.blocks);
  check("§11e KÖRLÜK ZEMİNİ: bayraklı liste fixture carilerini döndü", clOn.data.length >= 4, `satır=${clOn.data.length}`);
  check(
    "§11f KÖRLÜK ZEMİNİ: en az bir caride gecikmiş tutar VAR (yoksa eşitlik vakumen yeşil)",
    clOn.data.some((r) => (r.overdue ?? []).length > 0),
  );

  const listOverdueOf = (cariId: string, cur: string): string | null =>
    clOn.data.find((r) => r.id === cariId)?.overdue?.find((o) => o.currency === cur)?.amount ?? null;

  check("§11g ⭐ cariA/TRY: liste = aging = 3400 (FIFO mahsup DAHİL; naif formül 3800 derdi)",
    listOverdueOf(cariA, "TRY") === "3400.00" && rowOf(agingFinal, cariA)?.overdueTotal === "3400.00",
    `liste=${listOverdueOf(cariA, "TRY")} aging=${rowOf(agingFinal, cariA)?.overdueTotal}`,
  );
  check(
    "§11h cariA/USD: para birimi AYRI satır — liste = aging = 250",
    listOverdueOf(cariA, "USD") === "250.00" && rowOf(agingFinal, cariA, "USD")?.overdueTotal === "250.00",
    `liste=${listOverdueOf(cariA, "USD")} aging=${rowOf(agingFinal, cariA, "USD")?.overdueTotal}`,
  );
  check(
    "§11i cariB: vade türetimi + FIFO her şeyi kapattı → listede gecikmiş YOK (naif formül 700 derdi)",
    (clOn.data.find((r) => r.id === cariB)?.overdue ?? []).length === 0 &&
      rowOf(agingFinal, cariB)?.overdueTotal === "0.00",
    `liste=${JSON.stringify(clOn.data.find((r) => r.id === cariB)?.overdue)} aging=${rowOf(agingFinal, cariB)?.overdueTotal}`,
  );
  check(
    "§11j cariC: karşılıksız çek sonrası gecikmiş yeniden AÇIK — liste = aging = 1000",
    listOverdueOf(cariC, "TRY") === "1000.00" && rowOf(agingFinal, cariC)?.overdueTotal === "1000.00",
    `liste=${listOverdueOf(cariC, "TRY")} aging=${rowOf(agingFinal, cariC)?.overdueTotal}`,
  );
  // Genel tarama — İKİ YÖN: listenin bastığı her tutar aging'de birebir var VE
  // aging'in sıfır-dışı her satırı listede var (tek yön, eksik satırı kaçırır).
  {
    let diff = 0;
    for (const row of clOn.data) {
      const expected = agingFinal.filter(
        (r) => r.cariId === row.id && !new Prisma.Decimal(r.overdueTotal).isZero(),
      );
      const got = row.overdue ?? [];
      if (got.length !== expected.length) diff++;
      for (const o of got) {
        const m = expected.find((r) => r.currency === o.currency);
        if (!m || m.overdueTotal !== o.amount) diff++;
      }
    }
    check("§11k ⭐ TÜM fixture satırlarında liste ↔ aging birebir (iki yönlü)", diff === 0, `fark=${diff}`);
  }

  // ── BAYRAKSIZ YOL BAYT-BAYT: `overdue` alanı HİÇ yok + ek sorgu koşmaz ────
  const clOff = await cariService.list({ search: TAG, pageSize: 200 });
  check(
    "§11l Bayraksız listede `overdue` alanı HİÇ YOK (boş dizi bile değil)",
    clOff.data.length > 0 && clOff.data.every((r) => !("overdue" in r)),
  );
  // Kaynak taraması (ek-sorgu-yok garantisinin mekanik hâli): çağrı bayrak
  // kapısının içinde ve cari.service kendi gecikme formülünü YAZMIYOR.
  const cariSrc = fs.readFileSync(path.resolve(__dirname, "../src/services/cari.service.ts"), "utf8");
  check("§11m Tek kaynak: cari listesi collectAgingRows çağırıyor", cariSrc.includes("collectAgingRows({"));
  check(
    "§11n Çağrı `params.withOverdue` kapısının İÇİNDE (bayraksız yol ek sorgu koşmaz)",
    /if \(params\.withOverdue && rows\.length > 0\) \{\s*\n\s*const agingRows = await collectAgingRows\(/.test(cariSrc),
  );
  check(
    "§11o cari.service KENDİ gecikme SQL'ini/formülünü yazmıyor (ikinci formül yasak)",
    !/daysOverdue|d90plus|effectiveDue|payment_allocations/.test(cariSrc),
  );
  const agingSrc = fs.readFileSync(
    path.resolve(__dirname, "../src/services/reports/finance-aging.report.ts"),
    "utf8",
  );
  check(
    "§11p Rapor da AYNI çekirdekten okuyor (getAgingReport → collectAgingRows)",
    /const rows = await collectAgingRows\(params\);/.test(agingSrc),
  );

  // ── §12 KIRILIM FİXTURE'I (H7) ────────────────────────────────────────────
  // ⚠️ İKİSİ DE KASANIN DIŞINDA kurulur. §9c/§9d/§9e/§9p beklentileri tek tek
  // gerekçelendirilmiş sayılardır ("400 + 1200 + 200 iptal tersi"); kırılım
  // uğruna oynatmak o gerekçeleri okunamaz hâle getirirdi.
  //
  // (1) İPTAL ÇİFTİ — bankaya 700 TL "Nakliye" gideri, ardından iptal. Banka
  //     kapanışı DEĞİŞMEZ (çıkan 700 + giren 700), yani §9o de ayakta kalır;
  //     kırılımda ise kova "700 / 700 / net 0" göstermek ZORUNDA.
  const cancelledExpense = await cashTransactionService.create({
    kind: "EXPENSE",
    bankAccountId,
    amount: 700,
    txnDate: ago(2),
    category: "Nakliye",
    description: `${TAG} iptal edilecek gider`,
  });
  cashTxnIds.push(cancelledExpense.data.id);
  await cashTransactionService.cancel(cancelledExpense.data.id, "bekçi iptali");

  // (2) VİRMAN — İKİ YENİ hesap arasında. Mevcut kasa/banka kullanılsaydı iki
  //     bacaktan biri onların rakamlarını değiştirirdi; virmanın kırılımdaki
  //     yeri ise ayrıca test edilmek ZORUNDA, çünkü `TransferInput` kategori
  //     KABUL ETMEZ (bkz. rapor dosyasının başlığı: virman kendi kovasında).
  const vbFrom = await prisma.bankAccount.create({
    data: { code: `${TAG}-V1`, name: `${TAG} Virman kaynak`, currency: "TRY" },
    select: { id: true },
  });
  const vbTo = await prisma.bankAccount.create({
    data: { code: `${TAG}-V2`, name: `${TAG} Virman hedef`, currency: "TRY" },
    select: { id: true },
  });
  extraBankIds.push(vbFrom.id, vbTo.id);
  const virman = await cashTransactionService.transfer({
    fromBankAccountId: vbFrom.id,
    toBankAccountId: vbTo.id,
    amount: 100,
    txnDate: ago(1),
  });
  cashTxnIds.push(...virman.data.ids);

  // ── §9 KASA DEFTERİ ───────────────────────────────────────────────────────
  const book = await getCashBookReport({
    range: { from: ago(30), to: new Date() },
    accountId: cashBoxId,
  });
  const kasa = book.accounts.find((a) => a.accountId === cashBoxId);
  check("§9a KÖRLÜK ZEMİNİ: kasa hesabı ve hareketleri var", Boolean(kasa && kasa.movementCount > 0), `hareket=${kasa?.movementCount ?? 0}`);
  if (!kasa) throw new Error("Kasa bulunamadı.");
  check("§9b Devir sıfır (dönemden önce hareket yok)", kasa.opening === "0.00", kasa.opening);
  check("§9c Girişler: 400 + 1200 + 200 (iptal tersi) = 1800", kasa.totalIn === "1800.00", kasa.totalIn);
  check("§9d Çıkışlar: 300 gider + 200 ödeme = 500", kasa.totalOut === "500.00", kasa.totalOut);
  check("§9e Kapanış = 1300", kasa.closing === "1300.00", kasa.closing);
  check("§9f ⭐ Defter toplamı = kayıtlı kasa bakiyesi", kasa.storedDiff === "0.00", `stored=${kasa.storedBalance} diff=${kasa.storedDiff}`);

  const bookRows = book.rows ?? [];
  check("§9g Satır dökümü tek hesapta döndü", bookRows.length >= 4, `satır=${bookRows.length}`);
  check(
    "§9h İptal edilen ödeme İKİ satır (asıl + ters)",
    bookRows.filter((r) => r.source === "PAYMENT_CANCEL").length === 1 &&
      bookRows.filter((r) => r.source === "PAYMENT" && r.cancelled).length === 1,
  );
  check(
    "§9i Yürüyen bakiyenin son değeri = kapanış",
    bookRows.length > 0 && bookRows[bookRows.length - 1]?.running === kasa.closing,
    bookRows[bookRows.length - 1]?.running ?? "—",
  );
  check(
    "§9j Satırlar tarihe göre sıralı",
    bookRows.every((r, i) => i === 0 || new Date(bookRows[i - 1]!.date) <= new Date(r.date)),
  );
  check("§9k Carisiz kasa hareketi (gider) defterde", bookRows.some((r) => r.source === "CASH_TXN" && r.kind === "EXPENSE"));

  // ── §9s ⭐ SÜZGEÇ: DÖKÜM DARALIR, BAKİYE DEĞİŞMEZ (R5b-d) ──────────────────
  // Statik bekçi (`test_finans_rapor_eksenleri §4`) SIRAYI ölçer: `running` önce
  // yürütülür, süzgeç sonra uygulanır. SONUCU ancak burası görebilir — süzgeçli
  // listede kalan satırların `running`i, süzgeçsizdekiyle BİREBİR aynı olmalı.
  // Bu, kuralın tek yanlışlanabilir biçimi: sayı değişirse bakiye süzgece
  // bağlanmış demektir ve hiçbir metin taraması bunu gösteremez.
  const suzgecli = await getCashBookReport({
    range: { from: ago(30), to: new Date() },
    accountId: cashBoxId,
    kategori: "CASH_TXN",
  });
  const sRows = suzgecli.rows ?? [];
  check("§9s1 KÖRLÜK ZEMİNİ: süzgeç gerçekten daralttı (hepsi kalmadı, hiçbiri de gitmedi)",
    sRows.length > 0 && sRows.length < bookRows.length, `${sRows.length}/${bookRows.length} satır`);
  check("§9s2 ⭐ kalan satırların `running`i SÜZGEÇSİZDEKİYLE BİREBİR (bakiye süzgece bağlanmadı)",
    sRows.every((r) => bookRows.find((b) => b.id === r.id)?.running === r.running),
    sRows.map((r) => r.running).join(" · "));
  check("§9s3 ⭐ ÖZET dönem gerçeği kaldı (devir · giriş · çıkış · kapanış değişmedi)",
    (() => {
      const k = suzgecli.accounts.find((a) => a.accountId === cashBoxId);
      return k?.opening === kasa.opening && k?.totalIn === kasa.totalIn
        && k?.totalOut === kasa.totalOut && k?.closing === kasa.closing;
    })(),
    `${suzgecli.accounts.find((a) => a.accountId === cashBoxId)?.closing} ↔ ${kasa.closing}`);
  check("§9s4 elenen satır DOĞRU sayıldı",
    Number(suzgecli.suzgec?.dusenSatir) === bookRows.length - sRows.length,
    `dusenSatir=${suzgecli.suzgec?.dusenSatir} (beklenen ${bookRows.length - sRows.length})`);
  check("§9s5 beyan yalnız VERİLEN anahtarı taşır (`yon` gönderilmedi ⇒ anahtar YOK)",
    suzgecli.suzgec !== undefined && !("yon" in suzgecli.suzgec) && suzgecli.suzgec.kategori === "CASH_TXN",
    JSON.stringify(suzgecli.suzgec));
  check("§9s6 SÜZGEÇSİZ çağrıda `suzgec` anahtarı HİÇ YOK", !("suzgec" in book), JSON.stringify(book.suzgec));
  // ⭐ SEÇENEKLER SÜZGEÇTEN BAĞIMSIZ — kuralın tek yanlışlanabilir biçimi. Liste
  // süzgeçle daralsaydı seçici KENDİ KENDİNİ KİLİTLERDİ: kullanıcı seçimini
  // genişletmek isteyince genişleteceği değer listede olmazdı.
  check("§9s7 ⭐ `secenekler` süzgeçten BAĞIMSIZ (cari listesi daralmadı)",
    JSON.stringify(suzgecli.secenekler.cariId) === JSON.stringify(book.secenekler.cariId),
    `${suzgecli.secenekler.cariId?.length} ↔ ${book.secenekler.cariId?.length}`);
  check("§9s8 hesap seçenekleri hesap kataloğundan (iki tablo tek liste)",
    (book.secenekler.accountId?.length ?? 0) === book.accounts.length,
    `${book.secenekler.accountId?.length} seçenek ↔ ${book.accounts.length} hesap`);

  const bankBook = await getCashBookReport({
    range: { from: ago(30), to: new Date() },
    accountId: bankAccountId,
  });
  const banka = bankBook.accounts.find((a) => a.accountId === bankAccountId);
  check("§9l KÖRLÜK ZEMİNİ: banka hesabı raporda", Boolean(banka), banka?.closing ?? "YOK");
  check("§9m ÇEK TAHSİLİ defterde (üçüncü yazar)", (bankBook.rows ?? []).some((r) => r.source === "CHEQUE" && r.kind === "COLLECT"));
  check("§9n TAHSİLE VERME (DEPOSIT) deftere GİRMEDİ", !(bankBook.rows ?? []).some((r) => r.kind === "DEPOSIT"));
  check("§9o Çek tahsili bakiyeyle tutuyor", banka?.closing === "500.00" && banka.storedDiff === "0.00", `${banka?.closing}/${banka?.storedDiff}`);

  // DEVİR: dönem başlangıcı ileri alınınca önceki hareketler devre düşmeli.
  const bookLate = await getCashBookReport({ range: { from: ago(3), to: new Date() }, accountId: cashBoxId });
  const kasaLate = bookLate.accounts.find((a) => a.accountId === cashBoxId);
  // Dönem başı 3 güne çekilince önceki üç hareket (400 giriş, 200 çıkış,
  // 300 gider) devre düşer: −100. Kalan dönemde 1200 tahsilat + 200 iptal
  // tersi girer → kapanış yine 1300.
  check(
    "§9p Devir hareketlerden TÜRÜYOR (dönem daraltılınca devre düştü)",
    kasaLate?.opening === "-100.00",
    `devir=${kasaLate?.opening} giriş=${kasaLate?.totalIn} çıkış=${kasaLate?.totalOut}`,
  );
  check("§9r Daraltılmış dönemde de kapanış = kayıtlı bakiye", kasaLate?.closing === "1300.00" && kasaLate.storedDiff === "0.00");

  // ── §12 KASA DEFTERİ: KATEGORİ KIRILIMI (H7) ──────────────────────────────
  // Kırılımın DEĞERİ "bu para nereden geldi / nereye gitti" sorusudur; RİSKİ
  // ise sessizce yanlış toplamaktır (bir kova düşerse ekran hâlâ dolu ve
  // makul görünür). Bu yüzden asıl kontrol MUTABAKATTIR: kova toplamları
  // dönemin giren/çıkan toplamına EŞİT olmak zorunda.
  const catOf = (rep: { categories: typeof book.categories }, key: string, currency = "TRY") =>
    rep.categories.find((c) => c.key === key && c.currency === currency);

  const kasaCats = book.categories;
  check("§12a KÖRLÜK ZEMİNİ: kasa kırılımı satır üretti", kasaCats.length >= 2, `kova=${kasaCats.length}`);
  const kira = catOf(book, "CAT:Kira");
  check(
    "§12b Kasa hareketi KENDİ kategori metniyle gruplandı (Kira: çıkan 300)",
    kira?.group === "CASH_TXN" && kira.label === "Kira" && kira.totalOut === "300.00" && kira.totalIn === "0.00" && kira.movementCount === 1,
    kira ? `${kira.label} in=${kira.totalIn} out=${kira.totalOut} n=${kira.movementCount}` : "YOK",
  );
  const kasaPay = catOf(book, "PAYMENT");
  check(
    "§12c Carili tahsilat/ödeme TEK kovada (in 1800 · out 200 · 4 hareket — iptal çifti dahil)",
    kasaPay?.totalIn === "1800.00" && kasaPay.totalOut === "200.00" && kasaPay.movementCount === 4,
    kasaPay ? `in=${kasaPay.totalIn} out=${kasaPay.totalOut} n=${kasaPay.movementCount}` : "YOK",
  );
  check(
    "§12d Kasada ÇEK kovası YOK (kova gerçekten KAYNAĞA bakıyor, tutara değil)",
    catOf(book, "CHEQUE") === undefined,
  );
  check(
    "§12e ⭐ MUTABAKAT (kasa): Σ kova giren/çıkan = dönem giren/çıkan",
    kasaCats.reduce((s, c) => s.plus(new Prisma.Decimal(c.totalIn)), new Prisma.Decimal(0)).toFixed(2) === kasa.totalIn &&
      kasaCats.reduce((s, c) => s.plus(new Prisma.Decimal(c.totalOut)), new Prisma.Decimal(0)).toFixed(2) === kasa.totalOut,
    `kova=${kasaCats.reduce((s, c) => s.plus(new Prisma.Decimal(c.totalIn)), new Prisma.Decimal(0)).toFixed(2)}/${kasaCats
      .reduce((s, c) => s.plus(new Prisma.Decimal(c.totalOut)), new Prisma.Decimal(0))
      .toFixed(2)} hesap=${kasa.totalIn}/${kasa.totalOut}`,
  );

  // Banka: üçüncü yazar (çek) + İPTAL ÇİFTİNİN NETLEŞMESİ
  const cheqBucket = catOf(bankBook, "CHEQUE");
  check(
    "§12f Çek olayı tek kovada (banka: giren 500)",
    cheqBucket?.group === "CHEQUE" && cheqBucket.totalIn === "500.00",
    cheqBucket ? `in=${cheqBucket.totalIn}` : "YOK",
  );
  const nakliye = catOf(bankBook, "CAT:Nakliye");
  check(
    "§12g ⭐ İPTAL ÇİFTİ KIRILIMDA NETLEŞTİ (Nakliye: 700 çıkan + 700 giren = net 0, 2 hareket)",
    nakliye?.totalOut === "700.00" && nakliye.totalIn === "700.00" && nakliye.net === "0.00" && nakliye.movementCount === 2,
    nakliye ? `in=${nakliye.totalIn} out=${nakliye.totalOut} net=${nakliye.net} n=${nakliye.movementCount}` : "YOK",
  );
  // Netleşmenin TEK dayanağı: ters satır ASLININ kategorisini taşıyor. Taşımasa
  // mutabakat yine tutardı (toplam değişmez) ama gider kovası şişmiş kalır ve
  // iptal "Kategorisiz"e düşerdi — kırılım sessizce YANLIŞ olurdu.
  check(
    "§12h Ters satır ASLININ kategorisini miras aldı (bankada Kategorisiz kovası YOK)",
    catOf(bankBook, "CAT:") === undefined,
    JSON.stringify(bankBook.categories.map((c) => c.key)),
  );
  check(
    "§12i ⭐ MUTABAKAT (banka): iptal çiftiyle birlikte de Σ kova = dönem toplamı",
    bankBook.categories.reduce((s, c) => s.plus(new Prisma.Decimal(c.totalIn)), new Prisma.Decimal(0)).toFixed(2) ===
      banka?.totalIn &&
      bankBook.categories.reduce((s, c) => s.plus(new Prisma.Decimal(c.totalOut)), new Prisma.Decimal(0)).toFixed(2) ===
        banka?.totalOut,
    `hesap=${banka?.totalIn}/${banka?.totalOut}`,
  );

  // VİRMAN: kategori alanı OLMAYAN üçüncü kaynak. "Kategorisiz"e düşseydi
  // operatör düzeltilemeyen bir eksiklik görürdü (uç kategori KABUL ETMİYOR).
  const virmanOut = await getCashBookReport({ range: { from: ago(30), to: new Date() }, accountId: vbFrom.id });
  const virmanIn = await getCashBookReport({ range: { from: ago(30), to: new Date() }, accountId: vbTo.id });
  const vOut = catOf(virmanOut, "TRANSFER");
  check(
    "§12j Virman KENDİ kovasında (çıkan bacak 100) — Kategorisiz'e DÜŞMEDİ",
    vOut?.group === "TRANSFER" && vOut.totalOut === "100.00" && catOf(virmanOut, "CAT:") === undefined,
    JSON.stringify(virmanOut.categories.map((c) => `${c.key}:${c.totalOut}`)),
  );
  check(
    "§12k Virmanın giren bacağı da aynı kovada (100)",
    catOf(virmanIn, "TRANSFER")?.totalIn === "100.00",
    catOf(virmanIn, "TRANSFER")?.totalIn ?? "YOK",
  );

  // HESAP SEÇİLMEDEN: kırılım para birimi bazlı olduğu için burada da anlamlı
  // (yürüyen bakiyenin aksine). Bu sorgu DB'deki TÜM hesapları kapsar; bu
  // yüzden sabit rakam DEĞİL, mutabakat ölçülür — fixture dışı veri varsa da
  // eşitlik bozulmamalı.
  const allBook = await getCashBookReport({ range: { from: ago(30), to: new Date() } });
  check("§12l KÖRLÜK ZEMİNİ: çok hesaplı sorgu birden çok hesap gördü", allBook.accounts.length >= 3, `hesap=${allBook.accounts.length}`);
  check("§12m Hesap seçilmeden de kırılım DOLU (rows null iken bile)", allBook.rows === null && allBook.categories.length > 0);
  {
    const zero = () => ({ in: new Prisma.Decimal(0), out: new Prisma.Decimal(0) });
    const acc = new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal }>();
    for (const a of allBook.accounts) {
      const e = acc.get(a.currency) ?? zero();
      acc.set(a.currency, { in: e.in.plus(a.totalIn), out: e.out.plus(a.totalOut) });
    }
    const cat = new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal }>();
    for (const c of allBook.categories) {
      const e = cat.get(c.currency) ?? zero();
      cat.set(c.currency, { in: e.in.plus(c.totalIn), out: e.out.plus(c.totalOut) });
    }
    let diff = 0;
    const seen = new Set([...acc.keys(), ...cat.keys()]);
    for (const cur of seen) {
      const a = acc.get(cur) ?? zero();
      const c = cat.get(cur) ?? zero();
      if (!a.in.equals(c.in) || !a.out.equals(c.out)) diff++;
    }
    check(
      "§12n ⭐ MUTABAKAT (tüm hesaplar, PARA BİRİMİ bazında): Σ kova = Σ hesap",
      diff === 0 && seen.size > 0,
      `para birimi=${seen.size} sapma=${diff}`,
    );
  }
  check(
    "§12o Kırılım kuralı DİPNOTLA söylendi (kategori alanı olmayan kaynak uydurulmaz)",
    book.notes.some((n) => n.includes("Kategori kırılımı")) && book.notes.some((n) => n.includes("NETLEŞİR")),
  );

  // ── §10 REJİM KAPISI (mekanik kaynak taraması) ────────────────────────────
  // Bayrak kapısı fabrika sıfır-fark garantisinin ayağıdır ve bir refactor'da
  // sessizce düşebilir; hiçbir işlevsel test onu göremez.
  const routeFile = path.resolve(__dirname, "../src/routes/reports/finance.report.routes.ts");
  const src = fs.readFileSync(routeFile, "utf8");
  check("§10a KÖRLÜK ZEMİNİ: rota dosyası okundu", src.length > 500, `${src.length} bayt`);
  check("§10b Rejim kapısı (requireFinanceEnabled) router'da", /router\.use\([^)]*requireFinanceEnabled/.test(src));
  check("§10c İzin report:finance", src.includes('requirePermission("report:finance")'));
  check("§10d finance:read İZNİNE bağlanmamış", !src.includes('requirePermission("finance:read")'));
  for (const p of ["/aging", "/cash-book", "/statement"]) {
    check(`§10e ${p} ucu tanımlı`, src.includes(`"${p}"`));
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      // ⚠️ Temizlik, ORTA YERDE ÇÖKMÜŞ bir koşumu da toparlamak zorundadır:
      // id listeleri o noktaya kadar dolmuş olabilir. Bu yüzden bağlı kayıtlar
      // müşteri/fason üzerinden YENİDEN çözülür — aksi halde yarım kalan bir
      // koşum, sonraki koşumların mutabakat kontrollerini kirleten artık cari
      // bırakır (ve FK RESTRICT yüzünden müşteri de silinemez).
      const foundCaris = await prisma.cariAccount.findMany({
        where: { OR: [{ customerId: { in: customerIds } }, { subcontractorId: { in: subcontractorIds } }] },
        select: { id: true },
      });
      for (const c of foundCaris) if (!cariIds.includes(c.id)) cariIds.push(c.id);
      if (cariIds.length) {
        for (const r of await prisma.invoice.findMany({ where: { cariId: { in: cariIds } }, select: { id: true } })) {
          if (!invoiceIds.includes(r.id)) invoiceIds.push(r.id);
        }
        for (const r of await prisma.payment.findMany({ where: { cariId: { in: cariIds } }, select: { id: true } })) {
          if (!paymentIds.includes(r.id)) paymentIds.push(r.id);
        }
        for (const r of await prisma.cheque.findMany({ where: { cariId: { in: cariIds } }, select: { id: true } })) {
          if (!chequeIds.includes(r.id)) chequeIds.push(r.id);
        }
      }
      // ⚠️ OR koşulları TEK TEK eklenir: boş string bir uuid kolonuna filtre
      // olarak giderse Prisma P2023 fırlatır ve temizliğin TAMAMI yarıda kalır
      // (yarım koşumda `cashBoxId` hâlâ "" olabilir).
      const cashTxnAccountFilters: Prisma.CashTransactionWhereInput[] = [];
      if (cashBoxId) cashTxnAccountFilters.push({ cashBoxId });
      if (bankAccountId) cashTxnAccountFilters.push({ bankAccountId });
      if (extraBankIds.length) cashTxnAccountFilters.push({ bankAccountId: { in: extraBankIds } });
      if (cashTxnAccountFilters.length) {
        for (const r of await prisma.cashTransaction.findMany({
          where: { OR: cashTxnAccountFilters },
          select: { id: true },
        })) {
          if (!cashTxnIds.includes(r.id)) cashTxnIds.push(r.id);
        }
      }

      // FK sırası: defter satırları fatura/tahsilat/çeke RESTRICT ile bağlı.
      if (invoiceIds.length || paymentIds.length || chequeIds.length) {
        await prisma.paymentAllocation.deleteMany({
          where: {
            OR: [
              { invoiceId: { in: invoiceIds } },
              { paymentId: { in: paymentIds } },
              { chequeId: { in: chequeIds } },
            ],
          },
        });
      }
      if (cariIds.length) await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      if (chequeIds.length) {
        await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
        await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
      }
      if (invoiceIds.length) {
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      if (cashTxnIds.length) await prisma.cashTransaction.deleteMany({ where: { id: { in: cashTxnIds } } });
      if (cariIds.length) {
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
      if (cashBoxId) await prisma.cashBox.deleteMany({ where: { id: cashBoxId } });
      if (bankAccountId) await prisma.bankAccount.deleteMany({ where: { id: bankAccountId } });
      if (extraBankIds.length) await prisma.bankAccount.deleteMany({ where: { id: { in: extraBankIds } } });
      if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      if (subcontractorIds.length) await prisma.subcontractor.deleteMany({ where: { id: { in: subcontractorIds } } });
      // Kur satırı yalnız BİZ yazdıysak silinir — başka bir bekçinin/verinin
      // kuruna dokunmak, onun testini sessizce kırardı.
      if (usdRateCreated) {
        await prisma.exchangeRate.deleteMany({ where: { currency: "USD", source: "MANUAL", rate: new Prisma.Decimal("40") } });
      }
    } catch (e) {
      console.error("⚠️ Temizlik hatası:", (e as Error).message);
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
