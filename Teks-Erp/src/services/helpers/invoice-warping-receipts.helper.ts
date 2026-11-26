// =============================================================================
// DEVERE A1 — fatura ↔ devere dönüş KABULÜ bağları: kilit · doğrulama · pivot (tek yazar) · fark (uyarı)
// =============================================================================
// K1: bağ kabul (irsaliye) düzeyidir; bir fatura n kabul/n sipariş kapsar. "Kabul başına en çok BİR iptal edilmemiş
// fatura" DB'de korunamaz → kilit: ilgili `warping_orders` satırları id sırasıyla FOR UPDATE (kabul stornosunun sipariş
// claim'iyle aynı satır; ikisi serileşir) ve kapılar kilit ALTINDA taze okunur. K4: fark UYARIR, engellemez; döviz
// çevrilmez (farklı dövizde fark null). Pivot yalnız DRAFT'ta REPLACE; audit'i ebeveyn fatura eylemi basar.
// =============================================================================
import { InvoiceStatus, InvoiceType, Prisma, type Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readDevereReworkBillable, readFinanceInvoicePriceTolerancePct } from "../system-setting.service";
import { ACCEPTED_WARPING_BEAM_WHERE, loadWarpingOrderFeesTx, type WarpingOrderFee } from "./warping-fee.helper";
import { pctText } from "./qty-text.helper";
import { invoiceNetExVat } from "./invoice-net.helper";
import { paraMetni } from "../reports/anlati/sayi-bicim";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export const INVOICE_WARPING_CODES = {
  notLinkable: "WARPING_RECEIPT_NOT_LINKABLE",
  party: "WARPING_RECEIPT_PARTY_MISMATCH",
  invoiced: "WARPING_RECEIPT_ALREADY_INVOICED",
} as const;

export interface WarpingReceiptLinkRow { warpingReceiptKey: string; warpingOrderId: string }

/** Kabul anahtarlarının siparişlerini id sırasıyla kilitler (tx'te fatura claim'inden/fişlerden SONRA). */
export async function lockWarpingReceiptOrdersTx(tx: Tx, receiptKeys: string[]): Promise<void> {
  if (receiptKeys.length === 0) return;
  const rows = await tx.warpBeam.findMany({ where: { warpingReceiptKey: { in: receiptKeys }, warpingOrderId: { not: null } }, select: { warpingOrderId: true }, distinct: ["warpingOrderId"] });
  const ids = rows.map((r) => r.warpingOrderId!).sort();
  if (ids.length > 0) await tx.$queryRaw`SELECT "id" FROM "warping_orders" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
}

/**
 * Kabuller bağlanabilir mi (kilit altında): yalnız ALIŞ · kabul var ve kabul edilen sarımı var · sipariş deverecisi
 * faturanın carisi (karta çözülmüş) · başka iptal edilmemiş faturaya bağlı değil (409). Döner: pivot satırları.
 */
export async function assertWarpingReceiptsLinkableTx(
  db: Db,
  args: { receiptKeys: string[]; invoiceId: string | null; type: InvoiceType; cari: { customerId: string | null; subcontractorId: string | null } },
): Promise<WarpingReceiptLinkRow[]> {
  if (args.receiptKeys.length === 0) return [];
  if (args.type !== InvoiceType.PURCHASE) throw AppError.badRequest("Devere kabulü yalnız ALIŞ faturasına bağlanır.", { code: INVOICE_WARPING_CODES.notLinkable });
  const live = await db.warpBeam.findMany({
    where: { warpingReceiptKey: { in: args.receiptKeys }, ...ACCEPTED_WARPING_BEAM_WHERE },
    select: { warpingReceiptKey: true, warpingOrder: { select: { id: true, orderNo: true, subcontractor: { select: { id: true, name: true, customerId: true } } } } },
    distinct: ["warpingReceiptKey"],
  });
  const byKey = new Map(live.map((b) => [b.warpingReceiptKey!, b.warpingOrder!]));
  for (const key of args.receiptKeys) {
    const o = byKey.get(key);
    if (!o) throw AppError.badRequest("Devere kabulü bulunamadı ya da bütün leventleri geri alınmış — faturaya bağlanamaz.", { code: INVOICE_WARPING_CODES.notLinkable, warpingReceiptKey: key });
    const s = o.subcontractor;
    const same = (s.customerId !== null && s.customerId === args.cari.customerId) || s.id === args.cari.subcontractorId;
    if (!same) throw AppError.badRequest(`${o.orderNo} siparişinin deverecisi (${s.name}) bu faturanın carisi değil.`, { code: INVOICE_WARPING_CODES.party, warpingReceiptKey: key });
  }
  const busy = await db.invoiceToWarpingReceipt.findFirst({
    where: { warpingReceiptKey: { in: args.receiptKeys }, invoice: { status: { not: InvoiceStatus.CANCELLED }, ...(args.invoiceId ? { id: { not: args.invoiceId } } : {}) } },
    select: { warpingReceiptKey: true, warpingOrder: { select: { orderNo: true } }, invoice: { select: { docNo: true, status: true } } },
  });
  if (busy) {
    throw AppError.conflict(`${busy.warpingOrder.orderNo} siparişinin bu kabulü zaten faturalı: ${busy.invoice.docNo} (${busy.invoice.status === InvoiceStatus.DRAFT ? "taslak" : "onaylı"}). Yeni fatura için önce onu iptal edin.`, {
      code: INVOICE_WARPING_CODES.invoiced, warpingReceiptKey: busy.warpingReceiptKey, docNo: busy.invoice.docNo,
    });
  }
  return args.receiptKeys.map((k) => ({ warpingReceiptKey: k, warpingOrderId: byKey.get(k)!.id }));
}

/** TEK YAZAR — pivot REPLACE (③b; satırlar fatura başına küme). */
export async function writeInvoiceWarpingReceiptsTx(tx: Tx, invoiceId: string, rows: WarpingReceiptLinkRow[]): Promise<void> {
  await tx.invoiceToWarpingReceipt.deleteMany({ where: { invoiceId } });
  if (rows.length > 0) await tx.invoiceToWarpingReceipt.createMany({ data: rows.map((r) => ({ invoiceId, ...r })) });
}

/** Taslak düzenlemede kabul kümesi REPLACE: kilit → kapılar → yazım (tek sıra; `[]` temizler). */
export async function replaceInvoiceWarpingReceiptsTx(
  tx: Tx,
  args: { invoiceId: string; receiptKeys: string[]; type: InvoiceType; cari: { customerId: string | null; subcontractorId: string | null } },
): Promise<void> {
  const keys = [...new Set(args.receiptKeys)];
  await lockWarpingReceiptOrdersTx(tx, keys);
  const rows = await assertWarpingReceiptsLinkableTx(tx, { receiptKeys: keys, invoiceId: args.invoiceId, type: args.type, cari: args.cari });
  await writeInvoiceWarpingReceiptsTx(tx, args.invoiceId, rows);
}

export const INVOICE_WARPING_RECEIPT_SELECT = {
  select: { warpingOrderId: true, warpingReceiptKey: true, warpingOrder: { select: { orderNo: true } } },
  orderBy: { createdAt: "asc" as const },
} satisfies Prisma.Invoice$warpingReceiptLinksArgs;

export const toInvoiceWarpingReceiptDto = (l: { warpingOrderId: string; warpingReceiptKey: string; warpingOrder: { orderNo: string } }) => ({
  warpingOrderId: l.warpingOrderId, orderNo: l.warpingOrder.orderNo, receiptKey: l.warpingReceiptKey,
});

export interface WarpingFeeMatchDto {
  currency: Currency;
  orders: Array<{
    warpingOrderId: string; orderNo: string; feeUnit: string; feeUnitPrice: string | null; feeCurrency: Currency | null;
    receipts: Array<{ receiptKey: string; deliveryNoteNo: string | null; beamCount: number; qty: string; expectedAmount: string | null }>;
    qty: string; expectedAmount: string | null;
  }>;
  /** Σ beklenen — yalnız bütün siparişler fiyatlı ve faturayla aynı dövizdeyse. */
  expectedTotal: string | null;
  /** KDV hariç net = `subtotal` (satır iskontosu zaten düşülmüş; `invoiceNetExVat`). */
  invoiceNet: string;
  difference: string | null;
  diffPct: string | null;
  tolerancePct: number;
  /** |fark %| toleransı aşıyor — yalnız UYARI. */
  exceeded: boolean;
  currencyMismatch: boolean;
  missingPrice: boolean;
  warnings: string[];
}

const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);

/** Faturanın bağlı kabulleri ↔ beklenen devere ücreti (bilgi; bağsız faturada null). */
export async function warpingFeeMatchTx(db: Db, invoiceId: string): Promise<WarpingFeeMatchDto | null> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { currency: true, subtotal: true, warpingReceiptLinks: { select: { warpingReceiptKey: true } } } });
  if (!inv) throw AppError.notFound("Fatura bulunamadı.");
  const keys = inv.warpingReceiptLinks.map((l) => l.warpingReceiptKey);
  if (keys.length === 0) return null;
  const fees: WarpingOrderFee[] = await loadWarpingOrderFeesTx(db, { receiptKeys: keys }, { reworkBillable: await readDevereReworkBillable(db) });
  const tolerancePct = await readFinanceInvoicePriceTolerancePct(db);
  const net = invoiceNetExVat(inv);
  const warnings: string[] = [];
  let total = D(0);
  let missingPrice = false;
  let currencyMismatch = false;
  const orders = fees.map((o) => {
    const rs = o.receipts.filter((r) => keys.includes(r.receiptKey));
    const qty = rs.reduce((s, r) => s.plus(r.qty), D(0));
    const amount = o.feeUnitPrice ? rs.reduce((s, r) => s.plus(r.expectedAmount ?? 0), D(0)) : null;
    if (amount === null) missingPrice = true;
    else if (o.feeCurrency !== inv.currency) currencyMismatch = true;
    else total = total.plus(amount);
    return {
      warpingOrderId: o.id, orderNo: o.orderNo, feeUnit: o.feeUnit, feeUnitPrice: o.feeUnitPrice?.toString() ?? null, feeCurrency: o.feeCurrency,
      receipts: rs.map((r) => ({ receiptKey: r.receiptKey, deliveryNoteNo: r.deliveryNoteNo, beamCount: r.beamCount, qty: r.qty.toFixed(3), expectedAmount: r.expectedAmount ? money(r.expectedAmount) : null })),
      qty: qty.toFixed(3), expectedAmount: amount ? money(amount) : null,
    };
  });
  if (missingPrice) warnings.push("Bazı devere siparişlerinde ücret tanımlı değil — beklenen tutar hesaplanamadı.");
  if (currencyMismatch) warnings.push("Devere ücretinin para birimi faturanınkinden farklı — kur çevrilmez, fark hesaplanmadı.");
  const comparable = !missingPrice && !currencyMismatch;
  const diff = comparable ? net.minus(total) : null;
  const pct = diff && !total.isZero() ? diff.div(total).mul(100) : null;
  const exceeded = comparable && diff !== null && !diff.isZero() && (pct === null || pct.abs().gt(tolerancePct));
  if (exceeded) warnings.push(`Fatura beklenen devere ücretinden farklı: ${paraMetni(Number(diff!))} ${inv.currency}${pct ? ` (%${pctText(Number(pct.toDecimalPlaces(2)))})` : ""}. Onay engellenmez; kontrol edin.`);
  return {
    currency: inv.currency, orders, expectedTotal: comparable ? money(total) : null, invoiceNet: money(net),
    difference: diff ? money(diff) : null, diffPct: pct ? pct.toDecimalPlaces(2).toFixed(2) : null, tolerancePct, exceeded, currencyMismatch, missingPrice, warnings,
  };
}
