// =============================================================================
// BEKÇİ — CARİ BİRLEŞTİRME VİRMANI (D4-K3d, kullanıcı kararı 2026-10-30 "sektör standardı": virman fişi)
// =============================================================================
// Fikstür: aynı kartın iki hesabı — kaynak = eski fason bacağı (TRY iki açık fatura, biri vadesi geçmiş + kısmi
// tahsilat kapaması; USD bir fatura), hedef = kart hesabı (kendi TRY faturası); kaynakta geçmişte kapalı dönem.
//   §1 ön izleme yazmaz; kalemler yaşlandırma çekirdeğinden (vade + açık tutar) ve bakiyeye eşit
//   §2 uygula: kaynak her para biriminde 0, pasif + mergedIntoId; hedef bakiyesi = iki hesabın toplamı (kuruşu kuruşuna)
//   §3 YAŞLANDIRMA: önce (kaynak + hedef) kovaları = sonra hedef kovaları (vadesi geçmiş kalem vadesi geçmiş kalır);
//      iki hesapta da mutabakat farkı 0
//   §4 geçmiş değişmedi: kaynağın birleşme öncesi satırları (sayı + sağlama toplamı) ve ekstresi bayt-aynı; kapalı
//      dönem kaydı aynı + verify sapma yok
//   §5 idempotent: ikinci çağrı 0 yazım · §6 çözücü birleşmiş hesabı seçmez
//   §7 geri alma: bakiyeler birleşme öncesine eşit, hesap aktif, ileri satırlar duruyor (storno bağlı)
//   §8 eşzamanlı iki birleştirme → biri 409 (hareketli çift + sıfır bakiyeli çift: claim tek başına)
//   §9 engelli çift (portföyde çek · aktif kilit · bugün kapalı) → 409 CARI_MERGE_BLOCKED + liste, 0 yazım
//   §10 DB CHECK: mergedIntoId = id insert'i reddedilir
//   §11 birleşmiş kaynak donmuş: fatura iptali · kapama · kapama çözme 409 CARI_MERGED (çözücüden gizli bakiye doğmaz)
// ⭐ NEGATİF SONDA (2026-10-31): bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik `finally`de.
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { paymentAllocationService } from "../src/services/payment-allocation.service";
import { periodCloseService } from "../src/services/period-close.service";
import { cariService } from "../src/services/cari.service";
import { AGING_BUCKETS, collectAgingRows } from "../src/services/reports/finance-aging.report";
import { applyCariMerge, planCariMerge } from "../src/services/helpers/cari-merge.helper";
import { revertCariMerge } from "../src/services/helpers/cari-merge-revert.helper";
import { findCariAccountForCardTx } from "../src/services/helpers/finance.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-CBV-${process.pid}`;
const DAY = 86_400_000;
const ago = (d: number): Date => new Date(Date.now() - d * DAY);
const ids = { customers: [] as string[], subs: [] as string[], invoices: [] as string[], payments: [] as string[], cheques: [] as string[], cashBox: "" };
const kod = (e: unknown): string => (e instanceof AppError ? String((e.details as { code?: string } | undefined)?.code ?? e.statusCode) : String(e));

/** Kaynak: saf fason hesabı olarak doğar (faturalar ona), sonra karta bağlanır; hedef: kart hesabı elle (K3a öncesi çift). */
async function pairOf(n: number): Promise<{ card: string; sub: string; source: string; target: string }> {
  const card = (await prisma.customer.create({ data: { code: `${TAG}-K${n}`, name: `${TAG} kart ${n}` }, select: { id: true } })).id;
  ids.customers.push(card);
  const sub = (await prisma.subcontractor.create({ data: { code: `${TAG}-F${n}`, name: `${TAG} fason ${n}` }, select: { id: true } })).id;
  ids.subs.push(sub);
  return { card, sub, source: "", target: "" };
}
async function linkPair(p: { card: string; sub: string; source: string; target: string }): Promise<void> {
  const src = await prisma.cariAccount.findUnique({ where: { subcontractorId: p.sub }, select: { id: true } });
  p.source = src?.id ?? (await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: p.sub }, select: { id: true } })).id;
  await prisma.subcontractor.update({ where: { id: p.sub }, data: { customerId: p.card } });
  p.target = (await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: p.card }, select: { id: true } })).id;
}
async function sales(party: { customerId?: string; subcontractorId?: string }, amount: number, issueDate: Date, dueDate: Date | null, currency: Currency = "TRY"): Promise<string> {
  const d = await invoiceService.createDraft({
    type: "SALES", ...party, currency, exchangeRate: currency === "TRY" ? null : 30, issueDate, dueDate,
    lines: [{ description: "Bekçi kalemi", qty: 1, unit: "m", unitPrice: amount }],
  } as Parameters<typeof invoiceService.createDraft>[0]);
  ids.invoices.push(d.data.id);
  await invoiceService.confirm(d.data.id);
  return d.data.id;
}
const balances = async (cariId: string): Promise<Record<string, string>> => {
  const rows = await prisma.cariBalance.findMany({ where: { cariId }, select: { currency: true, balance: true }, orderBy: { currency: "asc" } });
  return Object.fromEntries(rows.map((r) => [r.currency, new Prisma.Decimal(r.balance).toFixed(2)]));
};
/** Sıfır satırlar dışarıda — virman hedefte para birimi satırı açar (0 bakiye), karşılaştırma değeri kıyaslar. */
const nonZero = async (cariId: string): Promise<string> => JSON.stringify(Object.fromEntries(Object.entries(await balances(cariId)).filter(([, v]) => v !== "0.00")));
const txnCount = (): Promise<number> => prisma.cariTransaction.count({ where: { cari: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] } } });
/** Para birimi başına kova toplamı (gross + net) — verilen hesapların toplamı. */
async function bucketsOf(cariIds: string[]): Promise<Record<string, string>> {
  const rows = await collectAgingRows({ asOf: new Date(), cariIds });
  const out: Record<string, Prisma.Decimal> = {};
  for (const r of rows) {
    for (const b of AGING_BUCKETS) {
      for (const side of ["gross", "net"] as const) {
        const k = `${r.currency}.${side}.${b}`;
        out[k] = (out[k] ?? new Prisma.Decimal(0)).plus(r[side][b]);
      }
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => !v.isZero()).sort().map(([k, v]) => [k, v.toFixed(2)]));
}
async function sourceDigest(cariId: string, before: Date): Promise<string> {
  const r = await prisma.$queryRaw<Array<{ n: bigint; h: string | null }>>(Prisma.sql`
    SELECT COUNT(*) AS n, md5(string_agg(id::text || debit::text || credit::text || "sourceType"::text || "txnDate"::text, ',' ORDER BY id)) AS h
      FROM cari_transactions WHERE "cariId" = ${cariId}::uuid AND "createdAt" < ${before}`);
  return `${r[0]!.n}:${r[0]!.h}`;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== Cari birleştirme virmanı bekçisi ===\n");
  const admin = await ensureTestAdmin();
  ids.cashBox = (await prisma.cashBox.create({ data: { code: `${TAG}-KS`, name: `${TAG} Kasa`, currency: "TRY" }, select: { id: true } })).id;
  try {
    // ── FİKSTÜR ──
    const p = await pairOf(1);
    const overdue = await sales({ subcontractorId: p.sub }, 1000, ago(45), ago(15));
    await sales({ subcontractorId: p.sub }, 500, ago(5), new Date(Date.now() + 25 * DAY));
    await sales({ subcontractorId: p.sub }, 200, ago(10), ago(2), "USD");
    const pay = await paymentService.create({ direction: "IN", method: "CASH", subcontractorId: p.sub, amount: 300, cashBoxId: ids.cashBox, paymentDate: ago(12) } as Parameters<typeof paymentService.create>[0]);
    ids.payments.push(pay.data.id);
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: overdue }, select: { paidTotal: true } });
    if (new Prisma.Decimal(paid.paidTotal).isZero()) await paymentAllocationService.allocate({ invoiceId: overdue, paymentId: pay.data.id, amount: 300 });
    await linkPair(p);
    await sales({ customerId: p.card }, 700, ago(3), new Date(Date.now() + 10 * DAY));
    const close = await periodCloseService.close({ cariId: p.source, currency: "TRY", periodEnd: ago(20) });
    const closeRow0 = await prisma.cariPeriodClose.findUniqueOrThrow({ where: { id: close.data.id }, select: { closingBalance: true, txnCount: true } });

    // §1
    const n0 = await txnCount();
    const plan = await planCariMerge(p.source, p.target);
    const srcBal0 = await balances(p.source);
    const tgtBal0 = await balances(p.target);
    const overdueItem = plan.items.find((i) => i.invoiceId === overdue);
    check("§1a ön izleme engelsiz, 3 faturalı kalem (kalemsiz yok), vadesi geçmiş kalem açık tutarıyla (700) ve vadesiyle",
      plan.blockers.length === 0 && plan.items.length === 3 && plan.items.every((i) => i.invoiceId) && overdueItem?.signedAmount === "700.00" && !!overdueItem.dueDate,
      JSON.stringify({ b: plan.blockers, items: plan.items }));
    check("§1b ön izleme YAZMAZ", (await txnCount()) === n0);
    const agingBefore = await bucketsOf([p.source, p.target]);
    const t0 = new Date();
    const digest0 = await sourceDigest(p.source, t0);
    const stmt = (): Promise<unknown> => cariService.statement({ cariId: p.source, currency: "TRY", from: ago(60), to: t0 });
    const stmt0 = JSON.stringify(await stmt());

    // §2
    const r = await applyCariMerge(p.source, p.target, admin.id);
    const srcAcc = await prisma.cariAccount.findUniqueOrThrow({ where: { id: p.source }, select: { isActive: true, mergedIntoId: true } });
    const srcBal1 = await balances(p.source);
    const tgtBal1 = await balances(p.target);
    check("§2a 6 bacak tek grupta; kaynak pasif + mergedIntoId = hedef", r.legs === 6 && !!r.transferGroupId && !srcAcc.isActive && srcAcc.mergedIntoId === p.target, JSON.stringify({ r, srcAcc }));
    check("§2b kaynak her para biriminde 0", Object.values(srcBal1).every((v) => v === "0.00") && Object.keys(srcBal1).length === 2, JSON.stringify(srcBal1));
    const sum = (c: string): string => new Prisma.Decimal(srcBal0[c] ?? 0).plus(tgtBal0[c] ?? 0).toFixed(2);
    check("§2c hedef bakiyesi = iki hesabın önceki toplamı (TRY 1900, USD 200)", tgtBal1.TRY === sum("TRY") && tgtBal1.USD === sum("USD") && tgtBal1.TRY === "1900.00" && tgtBal1.USD === "200.00", JSON.stringify({ srcBal0, tgtBal0, tgtBal1 }));

    // §3
    const agingAfter = await bucketsOf([p.target]);
    check("§3a ⭐ YAŞLANDIRMA: önce (kaynak + hedef) kovaları = sonra hedef kovaları", JSON.stringify(agingBefore) === JSON.stringify(agingAfter), `önce ${JSON.stringify(agingBefore)} · sonra ${JSON.stringify(agingAfter)}`);
    const tgtRows = await collectAgingRows({ asOf: new Date(), cariId: p.target, includeDetail: true });
    const moved = tgtRows.flatMap((x) => x.items ?? []).find((i) => i.invoiceId === overdue);
    check("§3b vadesi geçmiş kalem hedefte vadesi geçmiş (0-30) kovada, 700", moved?.bucket === "d0_30" && moved.open === "700.00", JSON.stringify(moved));
    const srcRows = await collectAgingRows({ asOf: new Date(), cariId: p.source, includeDetail: true });
    check("§3c mutabakat farkı iki hesapta 0; kaynakta açık kalem yok",
      [...srcRows, ...tgtRows].every((x) => x.reconDiff === "0.00") && srcRows.every((x) => x.openTotal === "0.00"), JSON.stringify(srcRows.map((x) => [x.currency, x.openTotal, x.reconDiff])));

    // §4
    check("§4a kaynağın birleşme öncesi satırları değişmedi (sayı + sağlama toplamı)", (await sourceDigest(p.source, t0)) === digest0);
    check("§4b kaynağın ekstresi (birleşme öncesi aralık) bayt-aynı", JSON.stringify(await stmt()) === stmt0);
    const closeRow1 = await prisma.cariPeriodClose.findUniqueOrThrow({ where: { id: close.data.id }, select: { closingBalance: true, txnCount: true } });
    const ver = await periodCloseService.verify(close.data.id);
    check("§4c kapalı dönem kaydı aynı, verify sapma yok", JSON.stringify(closeRow0) === JSON.stringify(closeRow1) && ver.data?.drift === false, JSON.stringify({ closeRow1, drift: ver.data?.drift }));

    // §5
    const n1 = await txnCount();
    const r2 = await applyCariMerge(p.source, p.target, admin.id);
    check("§5 aynı çift ikinci kez → 0 yazım", r2.alreadyMerged && r2.legs === 0 && (await txnCount()) === n1);

    // §6
    const byCard = await findCariAccountForCardTx(prisma, { customerId: p.card, subcontractorId: null }, { id: true });
    const bySub = await findCariAccountForCardTx(prisma, { customerId: null, subcontractorId: p.sub }, { id: true });
    check("§6 ⭐ çözücü birleşmiş hesabı seçmez (kart → hedef; eski bacak kimliğiyle → yok)", byCard?.id === p.target && bySub === null, JSON.stringify({ byCard, bySub }));

    // §7
    const rv = await revertCariMerge(p.source, "bekçi geri alma", admin.id);
    const srcAcc2 = await prisma.cariAccount.findUniqueOrThrow({ where: { id: p.source }, select: { isActive: true, mergedIntoId: true } });
    check("§7a geri alma: 6 storno, bakiyeler birleşme öncesine eşit, kaynak aktif + mergedIntoId null",
      rv.reversedLegs === 6 && (await nonZero(p.source)) === JSON.stringify(srcBal0) && (await nonZero(p.target)) === JSON.stringify(tgtBal0) && srcAcc2.isActive && srcAcc2.mergedIntoId === null,
      JSON.stringify({ rv, srcAcc2, s: await nonZero(p.source), srcBal0, t: await nonZero(p.target), tgtBal0 }));
    const fwd = await prisma.cariTransaction.count({ where: { transferGroupId: r.transferGroupId!, sourceType: "CARI_TRANSFER", reversedBy: { isNot: null } } });
    check("§7b ileri bacaklar silinmedi, her biri storno bağlı (6)", fwd === 6, String(fwd));
    check("§7c geri alma sonrası yaşlandırma birleşme öncesiyle aynı", JSON.stringify(await bucketsOf([p.source, p.target])) === JSON.stringify(agingBefore));
    const rv2 = await revertCariMerge(p.source, "ikinci geri alma").then(() => "geçti", kod);
    check("§7d birleşmemiş hesabı geri alma → 409 CARI_MERGE_NOT_MERGED", rv2 === "CARI_MERGE_NOT_MERGED", rv2);

    // §8 eşzamanlılık
    const both = await Promise.allSettled([applyCariMerge(p.source, p.target), applyCariMerge(p.source, p.target)]);
    const okN = both.filter((x) => x.status === "fulfilled" && !x.value.alreadyMerged).length;
    const errs = both.filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => (x.reason instanceof AppError ? x.reason.statusCode : String(x.reason)));
    check("§8a ⭐ hareketli çift eşzamanlı iki birleştirme → biri yazar, öbürü 409 (ya da zaten birleşmiş)", okN === 1 && (errs.every((s) => s === 409)), JSON.stringify({ okN, errs }));
    check("§8b eşzamanlı yarış sonrası hedef bakiyesi yine toplam", JSON.stringify(await balances(p.target)) === JSON.stringify(tgtBal1));
    const z = await pairOf(2);
    await linkPair(z);
    const zBoth = await Promise.allSettled([applyCariMerge(z.source, z.target), applyCariMerge(z.source, z.target)]);
    const zOk = zBoth.filter((x) => x.status === "fulfilled").length;
    const zErr = zBoth.filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => kod(x.reason));
    check("§8c ⭐ sıfır bakiyeli çift (kilitsiz, claim tek başına) eşzamanlı → biri 200, öbürü 409 CARI_MERGE_CONFLICT", zOk === 1 && zErr.join() === "CARI_MERGE_CONFLICT", JSON.stringify({ zOk, zErr }));

    // §11 birleşmiş kaynak DONMUŞ (p §8'de yeniden birleşti): iptal/kapama/çözme 409 CARI_MERGED, 0 yazım
    const n11 = await txnCount();
    const tgt11 = JSON.stringify(await balances(p.target));
    const alloc = await prisma.paymentAllocation.findFirstOrThrow({ where: { invoiceId: overdue, revokedAt: null }, select: { id: true } });
    const c11 = await invoiceService.cancel(overdue, "bekçi").then(() => "geçti", kod);
    const a11 = await paymentAllocationService.allocate({ invoiceId: overdue, paymentId: pay.data.id, amount: 1 }).then(() => "geçti", kod);
    const d11 = await paymentAllocationService.deallocate(alloc.id).then(() => "geçti", kod);
    const st11 = await prisma.invoice.findUniqueOrThrow({ where: { id: overdue }, select: { status: true, paidTotal: true } });
    check("§11 ⭐ birleşmiş kaynakta fatura iptali · kapama · kapama çözme → 409 CARI_MERGED, defter/bakiye/fatura aynı",
      c11 === "CARI_MERGED" && a11 === "CARI_MERGED" && d11 === "CARI_MERGED" && (await txnCount()) === n11 && JSON.stringify(await balances(p.target)) === tgt11 && st11.status === "CONFIRMED" && new Prisma.Decimal(st11.paidTotal).eq(300),
      JSON.stringify({ c11, a11, d11, st11 }));

    // §9 engelli çift
    const b = await pairOf(3);
    await sales({ subcontractorId: b.sub }, 100, ago(4), null);
    await linkPair(b);
    const chq = await prisma.cheque.create({ data: { docNo: `${TAG}-C3`, kind: "RECEIVED", status: "PORTFOLIO", cariId: b.source, amount: 50, amountTry: 50, issueDate: ago(4), postingDate: ago(4), dueDate: ago(-30) }, select: { id: true } });
    ids.cheques.push(chq.id);
    await prisma.cariHold.create({ data: { cariId: b.target, reasonCode: "OTHER", blocksInvoice: true, placedById: admin.id, clientToken: crypto.randomUUID() } });
    await periodCloseService.close({ cariId: b.source, currency: "TRY", periodEnd: new Date() });
    const nb = await txnCount();
    const bp = await planCariMerge(b.source, b.target);
    const be = await applyCariMerge(b.source, b.target).then(() => null, (e: unknown) => e);
    const bAcc = await prisma.cariAccount.findUniqueOrThrow({ where: { id: b.source }, select: { isActive: true, mergedIntoId: true } });
    check("§9a ⭐ engel listesi: çek + kilit + kapalı gün", bp.blockers.some((x) => x.includes(`${TAG}-C3`)) && bp.blockers.some((x) => /kilidi/.test(x)) && bp.blockers.some((x) => /kapalı dönem/.test(x)), JSON.stringify(bp.blockers));
    check("§9b uygula → 409 CARI_MERGE_BLOCKED + liste, 0 yazım, kaynak aktif",
      kod(be) === "CARI_MERGE_BLOCKED" && Array.isArray((be as AppError).details?.blockers) && (await txnCount()) === nb && bAcc.isActive && !bAcc.mergedIntoId, kod(be));

    // §10 DB CHECK
    const lone = (await prisma.customer.create({ data: { code: `${TAG}-K4`, name: `${TAG} kart 4` }, select: { id: true } })).id;
    ids.customers.push(lone);
    const selfId = crypto.randomUUID();
    const self = await prisma.$executeRaw`INSERT INTO cari_accounts (id, kind, "customerId", "isActive", "updatedAt", "mergedIntoId") VALUES (${selfId}::uuid, 'CUSTOMER', ${lone}::uuid, false, ${new Date()}, ${selfId}::uuid)`.then(() => "geçti", (e: unknown) => `${String(e)} ${JSON.stringify((e as { meta?: unknown }).meta ?? "")}`);
    check("§10 DB CHECK: mergedIntoId = id insert'i reddedilir", /cari_accounts_merged_self_ck/.test(self), self.slice(-300));
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds }, reversesTxnId: { not: null } } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
  await prisma.cashTransaction.deleteMany({ where: { cashBoxId: ids.cashBox } });
  await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } });
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
  await prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } });
  await prisma.cheque.deleteMany({ where: { id: { in: ids.cheques } } });
  await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariPeriodClose.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.updateMany({ where: { id: { in: accIds } }, data: { mergedIntoId: null } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  if (ids.cashBox) await prisma.cashBox.deleteMany({ where: { id: ids.cashBox } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...accIds, ...ids.invoices, ...ids.payments] } } });
}

main()
  .catch((e) => {
    console.error("HATA", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
