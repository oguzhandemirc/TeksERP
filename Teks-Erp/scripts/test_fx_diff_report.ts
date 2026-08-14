// =============================================================================
// KUR FARKI RAPORU BEKÇİSİ — `getFxDiffReport` (J2, 2026-08-15)
// =============================================================================
// Ölçülen kurallar (rapor dosyasının başlığındaki sözleşme):
//   §1 LEHTE: SALES USD (kur 30) → IN tahsilat (kur 35), 100 USD kapama =
//      +500.00 TL (debit tarafı: yüksek kaynak kuru = kambiyo kârı).
//   §2 ALEYHTE: PURCHASE USD (kur 35) → OUT ödeme (kur 40), 200 USD kapama =
//      −1000.00 TL (credit tarafı: yüksek kaynak kuru = fazla TL ödendi).
//   §3 TRY kapaması EVRENE GİRMEZ (kur farkı tanım gereği yok).
//   §4 SIFIR farklı satır DÖNER ama özet toplamlarını etkilemez.
//   §5 ÇEK kaynağı da hesaba girer (kendi kur damgasıyla).
//   §6 KAPAMA ÇÖZÜLÜNCE satır kendiliğinden düşer (türetme — saklama yok).
//   §7 KURUŞ: satır 2 haneye yuvarlanır; özet = yuvarlanmış satırların toplamı
//      (birebir eşitlik — "toplam tutmuyor" görüntüsü yapısal imkânsız).
//   §8 Süzgeçler: tarih penceresi + cariId.
//
// NEGATİF SONDALAR (2026-08-15, cp+shasum ile bayt-bayt geri yüklendi — ölçüldü):
//   • `invoiceLedgerSide` yerine sabit "debit" → §2b + §2c KIRMIZI (2 kontrol):
//     ALEYHTE satır +1000 (LEHTE) okundu — işaretin tek kaynağı olduğunun kanıtı.
//   • `currency: { not: "TRY" }` süzgeci kaldırılınca → §3 + §6 + §8b KIRMIZI
//     (3 kontrol): TRY kapaması 0,00 farkla listeye sızdı (evren kuralı kanıtı).
// =============================================================================

import { Prisma, ChequeKind, ChequeStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { paymentAllocationService } from "../src/services/payment-allocation.service";
import { getFxDiffReport } from "../src/services/reports/finance-fx-diff.report";

const TAG = `TEST-FXR-${Date.now()}`;
const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const customerIds: string[] = [];
const subcontractorIds: string[] = [];
const cariIds: string[] = [];
const invoiceIds: string[] = [];
const paymentIds: string[] = [];
const chequeIds: string[] = [];
const cashBoxIds: string[] = [];

/** Raporu tüm evren için koşar (geniş pencere) — satırlar TAG'li belgelerle süzülür. */
async function report(opts?: { from?: Date; to?: Date; cariId?: string }): Promise<Awaited<ReturnType<typeof getFxDiffReport>>> {
  return getFxDiffReport({
    range: {
      from: opts?.from ?? new Date(Date.now() - 3_600_000),
      to: opts?.to ?? new Date(Date.now() + 3_600_000),
    },
    cariId: opts?.cariId,
  });
}

/** Bu testin ürettiği satırlar (başkasının eşzamanlı verisiyle karışmasın). */
function mine(r: Awaited<ReturnType<typeof getFxDiffReport>>): typeof r.rows {
  return r.rows.filter((row) => row.invoice.docNo && invoiceDocNos.has(row.invoice.docNo));
}
const invoiceDocNos = new Set<string>();

async function makeFxInvoice(opts: {
  customerId?: string;
  subcontractorId?: string;
  type: "SALES" | "PURCHASE";
  currency?: "USD" | "TRY";
  rate: number;
  total: number;
}): Promise<string> {
  const r = await invoiceService.createDraft({
    type: opts.type,
    customerId: opts.customerId ?? null,
    subcontractorId: opts.subcontractorId ?? null,
    currency: opts.currency ?? "USD",
    exchangeRate: opts.rate,
    lines: [{ description: `${TAG} satır`, qty: 1, unitPrice: opts.total, vatRate: 0 }],
  });
  invoiceIds.push(r.data.id);
  invoiceDocNos.add(r.data.docNo);
  await invoiceService.confirm(r.data.id);
  return r.data.id;
}

async function main(): Promise<void> {
  console.log("=== Kur farkı raporu bekçisi ===\n");

  // ── FİKSTÜR ──────────────────────────────────────────────────────────────
  const customer = await prisma.customer.create({ data: { code: TAG, name: `${TAG} Müşteri` }, select: { id: true } });
  customerIds.push(customer.id);
  const supplier = await prisma.subcontractor.create({
    data: { code: `${TAG}-T`, name: `${TAG} Tedarikçi` },
    select: { id: true },
  });
  subcontractorIds.push(supplier.id);
  const usdBox = await prisma.cashBox.create({
    data: { code: `${TAG}-KU`.slice(0, 32), name: `${TAG} USD Kasa`, currency: "USD" },
    select: { id: true },
  });
  cashBoxIds.push(usdBox.id);
  const tryBox = await prisma.cashBox.create({
    data: { code: `${TAG}-KT`.slice(0, 32), name: `${TAG} TL Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxIds.push(tryBox.id);

  // ── §1 LEHTE (SALES: fatura kuru 30 → tahsilat kuru 35) ─────────────────
  const invSale = await makeFxInvoice({ customerId: customer.id, type: "SALES", rate: 30, total: 100 });
  const payIn = await paymentService.create({
    direction: "IN",
    method: "CASH",
    customerId: customer.id,
    currency: "USD",
    exchangeRate: 35,
    amount: 100,
    cashBoxId: usdBox.id,
  });
  paymentIds.push(payIn.data.id);
  await paymentAllocationService.allocate({ invoiceId: invSale, paymentId: payIn.data.id, amount: 100 });

  let r = await report();
  let rows = mine(r);
  check("§1a LEHTE satırı doğdu", rows.length === 1, `satır=${rows.length}`);
  check("§1b Fark +500.00 (100 × (35−30))", rows[0]?.signedDiffTry === "500", rows[0]?.signedDiffTry);
  check("§1c Kaynak etiketi 'Tahsilat' + kurlar okunuyor", rows[0]?.source.label === "Tahsilat" && rows[0]?.invoice.exchangeRate === "30" && rows[0]?.source.exchangeRate === "35");

  // ── §2 ALEYHTE (PURCHASE: fatura kuru 35 → ödeme kuru 40) ────────────────
  const invPur = await makeFxInvoice({ subcontractorId: supplier.id, type: "PURCHASE", rate: 35, total: 200 });
  const payOut = await paymentService.create({
    direction: "OUT",
    method: "CASH",
    subcontractorId: supplier.id,
    currency: "USD",
    exchangeRate: 40,
    amount: 200,
    cashBoxId: usdBox.id,
  });
  paymentIds.push(payOut.data.id);
  await paymentAllocationService.allocate({ invoiceId: invPur, paymentId: payOut.data.id, amount: 200 });

  r = await report();
  rows = mine(r);
  const purRow = rows.find((x) => x.invoice.type === "PURCHASE");
  check("§2a ALEYHTE satırı doğdu", Boolean(purRow));
  check("§2b Fark −1000.00 (credit tarafı: fazla TL ödendi)", purRow?.signedDiffTry === "-1000", purRow?.signedDiffTry);
  check(
    "§2c Özet: lehte 500 · aleyhte 1000 · net −500 (yalnız bu testin evreni sayılmaz — işaret kuralı satırlardan)",
    D(purRow?.signedDiffTry ?? 0).lt(0) && D(rows.find((x) => x.invoice.type === "SALES")?.signedDiffTry ?? 0).gt(0),
  );

  // ── §3 TRY KAPAMASI EVRENE GİRMEZ ────────────────────────────────────────
  const invTry = await invoiceService.createDraft({
    type: "SALES",
    customerId: customer.id,
    currency: "TRY",
    lines: [{ description: `${TAG} TL satır`, qty: 1, unitPrice: 400, vatRate: 0 }],
  });
  invoiceIds.push(invTry.data.id);
  invoiceDocNos.add(invTry.data.docNo);
  await invoiceService.confirm(invTry.data.id);
  const payTry = await paymentService.create({
    direction: "IN",
    method: "CASH",
    customerId: customer.id,
    currency: "TRY",
    amount: 400,
    cashBoxId: tryBox.id,
  });
  paymentIds.push(payTry.data.id);
  await paymentAllocationService.allocate({ invoiceId: invTry.data.id, paymentId: payTry.data.id, amount: 400 });

  r = await report();
  rows = mine(r);
  check("§3 TRY kapaması listede YOK (evren: dövizli fatura)", rows.every((x) => x.invoice.currency !== "TRY") && rows.length === 2, `satır=${rows.length}`);

  // ── §4 SIFIR FARK: satır döner, özet etkilenmez ──────────────────────────
  const invZero = await makeFxInvoice({ customerId: customer.id, type: "SALES", rate: 30, total: 50 });
  const payZero = await paymentService.create({
    direction: "IN",
    method: "CASH",
    customerId: customer.id,
    currency: "USD",
    exchangeRate: 30,
    amount: 50,
    cashBoxId: usdBox.id,
  });
  paymentIds.push(payZero.data.id);
  await paymentAllocationService.allocate({ invoiceId: invZero, paymentId: payZero.data.id, amount: 50 });

  r = await report();
  rows = mine(r);
  const zeroRow = rows.find((x) => x.signedDiffTry === "0");
  check("§4a Sıfır farklı satır DÖNDÜ (dövizli kapama vardı, fark yoktu)", Boolean(zeroRow), `satır=${rows.length}`);

  // ── §5 ÇEK KAYNAĞI ───────────────────────────────────────────────────────
  const cariRow = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: customer.id }, select: { id: true } });
  cariIds.push(cariRow.id);
  const invCheq = await makeFxInvoice({ customerId: customer.id, type: "SALES", rate: 32, total: 80 });
  const cheque = await prisma.cheque.create({
    data: {
      docNo: `${TAG}-CK1`.slice(0, 32),
      kind: ChequeKind.RECEIVED,
      status: ChequeStatus.PORTFOLIO,
      cariId: cariRow.id,
      currency: "USD",
      exchangeRate: 34,
      amount: 80,
      amountTry: D(80).mul(34),
      issueDate: new Date(),
      dueDate: new Date(),
      postingDate: new Date(),
    },
    select: { id: true },
  });
  chequeIds.push(cheque.id);
  await paymentAllocationService.allocate({ invoiceId: invCheq, chequeId: cheque.id, amount: 80 });

  r = await report();
  rows = mine(r);
  const cheqRow = rows.find((x) => x.source.kind === "CHEQUE");
  check("§5a Çek kapaması hesaba girdi", Boolean(cheqRow));
  check("§5b Fark +160.00 (80 × (34−32)) ve etiket 'Aldığımız çek/senet'", cheqRow?.signedDiffTry === "160" && cheqRow?.source.label === "Aldığımız çek/senet", cheqRow?.signedDiffTry);

  // ── §6 KAPAMA ÇÖZÜLÜNCE SATIR DÜŞER (türetme kanıtı) ─────────────────────
  // Fatura iptali releaseAllocationsForInvoiceTx'i çağırır → kapama silinir.
  await invoiceService.cancel(invZero, "bekçi: çözme sondası");
  r = await report();
  rows = mine(r);
  check("§6 İptalle çözülen kapamanın satırı kendiliğinden düştü", !rows.some((x) => x.signedDiffTry === "0") && rows.length === 3, `satır=${rows.length}`);

  // ── §7 KURUŞ SÖZLEŞMESİ ──────────────────────────────────────────────────
  // 33.33 USD × (30.654321 − 30.123456) = 17.69373045 → satırda 17.69.
  const invCent = await makeFxInvoice({ customerId: customer.id, type: "SALES", rate: 30.123456, total: 33.33 });
  const payCent = await paymentService.create({
    direction: "IN",
    method: "CASH",
    customerId: customer.id,
    currency: "USD",
    exchangeRate: 30.654321,
    amount: 33.33,
    cashBoxId: usdBox.id,
  });
  paymentIds.push(payCent.data.id);
  await paymentAllocationService.allocate({ invoiceId: invCent, paymentId: payCent.data.id, amount: 33.33 });

  r = await report();
  rows = mine(r);
  const centRow = rows.find((x) => x.invoice.exchangeRate === "30.123456");
  check("§7a Satır kuruşa yuvarlı (17.69 — tam değer 17.69373045)", centRow?.signedDiffTry === "17.69", centRow?.signedDiffTry);
  {
    // Özet toplam = satır toplamı BİREBİR (yalnız bu testin evreninde değil,
    // raporun KENDİ evreninde — sözleşme global).
    const gain = r.rows.filter((x) => D(x.signedDiffTry).gt(0)).reduce((a, x) => a.plus(x.signedDiffTry), D(0));
    const loss = r.rows.filter((x) => D(x.signedDiffTry).lt(0)).reduce((a, x) => a.plus(D(x.signedDiffTry).abs()), D(0));
    check("§7b Özet gain = Σ pozitif satır (birebir)", D(r.summary.gainTry).equals(gain), `${r.summary.gainTry} ↔ ${gain.toString()}`);
    check("§7c Özet loss = Σ |negatif satır| (birebir)", D(r.summary.lossTry).equals(loss), `${r.summary.lossTry} ↔ ${loss.toString()}`);
    check("§7d net = gain − loss", D(r.summary.netTry).equals(D(r.summary.gainTry).minus(r.summary.lossTry)));
  }

  // ── §8 SÜZGEÇLER ─────────────────────────────────────────────────────────
  const past = await report({ from: new Date(Date.now() - 7_200_000), to: new Date(Date.now() - 3_600_000) });
  check("§8a Tarih penceresi: geçmiş pencerede bu testin satırı yok", mine(past).length === 0);
  const byCari = await report({ cariId: cariRow.id });
  check("§8b cariId süzgeci: yalnız müşterinin satırları (tedarikçi PURCHASE dışarıda)", mine(byCari).every((x) => x.invoice.type !== "PURCHASE") && mine(byCari).length === 3, `satır=${mine(byCari).length}`);

  // ── KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────────
  check("Körlük zemini: en az 4 dövizli kapama üretildi", invoiceDocNos.size >= 5);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (invoiceIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      if (chequeIds.length > 0) {
        await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
        await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: chequeIds } } });
        await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
      }
      if (invoiceIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.printedDocument.deleteMany({ where: { docType: "INVOICE_INTERNAL", sourceId: { in: invoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      if (paymentIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await prisma.printedDocument.deleteMany({ where: { docType: "PAYMENT_RECEIPT", sourceId: { in: paymentIds } } });
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      }
      if (cariIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
      // Tedarikçinin carisi customer carisiyle aynı listede olmayabilir — kalanı süpür.
      await prisma.cariTransaction.deleteMany({ where: { cari: { subcontractorId: { in: subcontractorIds } } } });
      await prisma.cariBalance.deleteMany({ where: { cari: { subcontractorId: { in: subcontractorIds } } } });
      await prisma.cariAccount.deleteMany({ where: { subcontractorId: { in: subcontractorIds } } });
      if (cashBoxIds.length > 0) {
        await prisma.cashTransaction.deleteMany({ where: { cashBoxId: { in: cashBoxIds } } });
        await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
      }
      if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      if (subcontractorIds.length > 0) await prisma.subcontractor.deleteMany({ where: { id: { in: subcontractorIds } } });
    } catch (e) {
      console.error("⚠️  Temizlik tamamlanamadı:", (e as Error).message);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
