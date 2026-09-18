// =============================================================================
// n İRSALİYE → 1 FATURA (2026-09-18) — fatura ↔ mal kabul fişi bağları: doğrulama · pivot (tek yazar) · DTO · tolerans
// =============================================================================
// Alış faturası birden çok mal kabul fişini kapatır (sektör: SAP MM fatura doğrulama). Pivot `InvoiceToGoodsReceipt`
// ③b saf yapılandırma: gövde `goodsReceiptIds` REPLACE; `Invoice.goodsReceiptId` kolonu tek fişte AYRICA dolar (eski
// istemci/okuyucu), n>1 fişte NULL — TEK YAZAR `writeInvoiceReceiptsTx`. "Bir fiş → en çok BİR iptal edilmemiş fatura"
// kapısı burada (409; `goods_receipts FOR UPDATE` çağıranın tx'inde). Tolerans (`finance.invoiceMatchTolerance`, varsayılan
// KAPALI = kontrol yok) ONAY anında ölçülür; taslakta yalnız `receiptMatch` bilgi olarak döner.
// =============================================================================
import { InvoiceStatus, InvoiceType, Prisma, RollStatus, YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { resolvePartyToCardTx } from "./party-card.helper";
import { receiptQtyByRollTx } from "./receipt-qty.helper";
import { goodsReceiptService, type ReceiptFabricLine, type ReceiptYarnLine } from "../goods-receipt.service";
import { readFinanceInvoicePriceTolerancePct, readFinanceInvoiceQtyTolerancePct, resolveInvoiceMatchToleranceEnabled } from "../system-setting.service";

type Db = Prisma.TransactionClient | typeof prisma;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export const INVOICE_RECEIPT_CODES = {
  notLinkable: "GOODS_RECEIPT_NOT_LINKABLE",
  party: "GOODS_RECEIPT_PARTY_MISMATCH",
  currency: "GOODS_RECEIPT_CURRENCY_MISMATCH",
  invoiced: "GOODS_RECEIPT_ALREADY_INVOICED",
  mismatch: "INVOICE_RECEIPT_MISMATCH",
} as const;

export const INVOICE_RECEIPT_SELECT = {
  select: { goodsReceipt: { select: { id: true, receiptNo: true, deliveryNoteNo: true, createdAt: true, status: true, currency: true } } },
  orderBy: { createdAt: "asc" as const },
} satisfies Prisma.Invoice$goodsReceiptLinksArgs;

export interface InvoiceReceiptDto {
  id: string;
  receiptNo: string;
  deliveryNoteNo: string | null;
  receivedAt: Date;
  status: string;
  currency: string;
}
export const toInvoiceReceiptDto = (l: { goodsReceipt: { id: string; receiptNo: string; deliveryNoteNo: string | null; createdAt: Date; status: string; currency: string } }): InvoiceReceiptDto => ({
  id: l.goodsReceipt.id,
  receiptNo: l.goodsReceipt.receiptNo,
  deliveryNoteNo: l.goodsReceipt.deliveryNoteNo,
  receivedAt: l.goodsReceipt.createdAt,
  status: l.goodsReceipt.status,
  currency: l.goodsReceipt.currency,
});

/** Gövde → tekil küme; eski `goodsReceiptId` alanı kümeye katılır (eski istemci: tek fiş). */
export function normalizeInvoiceReceiptIds(input: { goodsReceiptIds?: string[] | null; goodsReceiptId?: string | null }): string[] | null {
  if (input.goodsReceiptIds === undefined && !input.goodsReceiptId) return null;
  const ids = [...(input.goodsReceiptIds ?? []), ...(input.goodsReceiptId ? [input.goodsReceiptId] : [])];
  return [...new Set(ids)];
}

/**
 * Fişler bağlanabilir mi: var + iptal değil · tedarikçisi (karta çözülmüş) faturanın carisiyle aynı · para birimi aynı ·
 * iptal edilmemiş BAŞKA bir faturaya bağlı değil (409). Yalnız ALIŞ faturası fişe bağlanır.
 * ⚠️ Çağıran tx içinde `goods_receipts FOR UPDATE` ile serileşir (`lockReceiptsTx`); iki taslak aynı fişi aynı anda alamaz.
 */
export async function assertReceiptsLinkableTx(
  db: Db,
  args: { receiptIds: string[]; invoiceId: string | null; type: InvoiceType; currency: string; cari: { customerId: string | null; subcontractorId: string | null } },
): Promise<void> {
  if (args.receiptIds.length === 0) return;
  if (args.type !== InvoiceType.PURCHASE) throw AppError.badRequest("Mal kabul fişi yalnız ALIŞ faturasına bağlanır.", { code: INVOICE_RECEIPT_CODES.notLinkable });
  const rows = await db.goodsReceipt.findMany({
    where: { id: { in: args.receiptIds } },
    select: { id: true, receiptNo: true, status: true, currency: true, supplierId: true, subcontractorId: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of args.receiptIds) {
    const r = byId.get(id);
    if (!r) throw AppError.badRequest("Mal kabul fişi bulunamadı.", { code: INVOICE_RECEIPT_CODES.notLinkable, goodsReceiptId: id });
    if (r.status === "CANCELLED") throw AppError.badRequest(`${r.receiptNo} iptal edilmiş — faturaya bağlanamaz.`, { code: INVOICE_RECEIPT_CODES.notLinkable, goodsReceiptId: id });
    if (!r.supplierId && !r.subcontractorId) throw AppError.badRequest(`${r.receiptNo} fişinde tedarikçi seçilmemiş — alış faturası için tedarikçi gerekli.`, { code: INVOICE_RECEIPT_CODES.party, goodsReceiptId: id });
    if (r.currency !== args.currency) throw AppError.badRequest(`${r.receiptNo} fişinin para birimi (${r.currency}) faturanınkinden (${args.currency}) farklı.`, { code: INVOICE_RECEIPT_CODES.currency, goodsReceiptId: id });
    // Fiş tarafı karta çözülür (tedarikçi kimliğinin tek adresi kart); cari hesabın kartı/profiliyle kıyaslanır.
    const card = await resolvePartyToCardTx(db, { customerId: r.supplierId, subcontractorId: r.subcontractorId });
    const same = (card.customerId !== null && card.customerId === args.cari.customerId) || (card.subcontractorId !== null && card.subcontractorId === args.cari.subcontractorId);
    if (!same) throw AppError.badRequest(`${r.receiptNo} fişinin tedarikçisi bu faturanın carisi değil.`, { code: INVOICE_RECEIPT_CODES.party, goodsReceiptId: id });
  }
  // Başka aktif faturaya bağlı mı (pivot + eski kolon; kendi faturası hariç).
  const busy = await db.invoice.findFirst({
    where: {
      status: { not: InvoiceStatus.CANCELLED },
      ...(args.invoiceId ? { id: { not: args.invoiceId } } : {}),
      OR: [{ goodsReceiptId: { in: args.receiptIds } }, { goodsReceiptLinks: { some: { goodsReceiptId: { in: args.receiptIds } } } }],
    },
    select: { docNo: true, status: true, goodsReceiptId: true, goodsReceiptLinks: { select: { goodsReceiptId: true } } },
  });
  if (busy) {
    const hit = args.receiptIds.find((id) => busy.goodsReceiptId === id || busy.goodsReceiptLinks.some((l) => l.goodsReceiptId === id));
    const no = hit ? byId.get(hit)?.receiptNo ?? hit : "?";
    throw AppError.conflict(`${no} fişi için zaten bir fatura var: ${busy.docNo} (${busy.status === "DRAFT" ? "taslak" : "onaylı"}). Yeni fatura için önce onu iptal edin.`, { code: INVOICE_RECEIPT_CODES.invoiced, goodsReceiptId: hit ?? null, docNo: busy.docNo });
  }
}

/** Fiş satırlarını kilitler (kilit sırası: fatura → goods_receipts; iptal tarafıyla ABBA yok — confirm ile aynı). */
export async function lockReceiptsTx(tx: Prisma.TransactionClient, receiptIds: string[]): Promise<void> {
  if (receiptIds.length === 0) return;
  const sorted = [...receiptIds].sort();
  await tx.$queryRaw`SELECT "id" FROM "goods_receipts" WHERE "id" = ANY(${sorted}::uuid[]) FOR UPDATE`;
}

export interface ReceiptMatchDifference {
  kind: "QTY" | "AMOUNT";
  invoice: number;
  receipts: number;
  diffPct: number;
  tolerancePct: number;
  exceeded: boolean;
}
export interface ReceiptMatchDto {
  checked: boolean;
  qtyTolerancePct: number;
  priceTolerancePct: number;
  differences: ReceiptMatchDifference[];
}

/** Fişlerin kalem toplamı — kumaş: kabul metrajı (iptal top hariç) × donmuş fiyat; iplik: IN satırları × donmuş fiyat. */
export async function receiptTotalsTx(db: Db, receiptIds: string[]): Promise<{ qty: Prisma.Decimal; amount: Prisma.Decimal }> {
  let qty = D(0);
  let amount = D(0);
  for (const id of receiptIds) {
    const asm = await goodsReceiptService.assembleReceiptLines(id);
    const fabric = asm.lines.filter((l): l is ReceiptFabricLine => l.kind === "FABRIC" && l.status !== RollStatus.CANCELLED);
    const yarn = asm.lines.filter((l): l is ReceiptYarnLine => l.kind === "YARN" && l.movementKind === YarnMovementKind.IN);
    const q = await receiptQtyByRollTx(db, fabric.map((l) => l.id));
    for (const r of fabric) {
      const m = q.get(r.id)?.qty ?? D(0);
      qty = qty.plus(m);
      amount = amount.plus(m.mul(D(r.purchasePrice ?? 0)));
    }
    for (const y of yarn) {
      qty = qty.plus(D(y.qtyKg));
      amount = amount.plus(D(y.qtyKg).mul(D(y.unitPrice ?? 0)));
    }
  }
  return { qty, amount };
}

const pct = (a: Prisma.Decimal, b: Prisma.Decimal): number => (b.isZero() ? (a.isZero() ? 0 : 100) : Number(a.minus(b).abs().div(b).mul(100).toDecimalPlaces(2)));

/** Fatura ↔ fişler karşılaştırması; `checked` = kontrol ETKİN (bayrak açık); `exceeded` yalnız checked'te true olabilir. */
export async function receiptMatchTx(
  db: Db,
  args: { receiptIds: string[]; lines: Array<{ qty: Prisma.Decimal.Value; unitPrice: Prisma.Decimal.Value; discountRate?: Prisma.Decimal.Value | null }> },
): Promise<ReceiptMatchDto | null> {
  if (args.receiptIds.length === 0) return null;
  const checked = await resolveInvoiceMatchToleranceEnabled(db);
  const qtyTolerancePct = await readFinanceInvoiceQtyTolerancePct(db);
  const priceTolerancePct = await readFinanceInvoicePriceTolerancePct(db);
  const totals = await receiptTotalsTx(db, args.receiptIds);
  let invQty = D(0);
  let invAmount = D(0);
  for (const l of args.lines) {
    const q = D(l.qty);
    invQty = invQty.plus(q);
    const disc = D(l.discountRate ?? 0);
    invAmount = invAmount.plus(q.mul(D(l.unitPrice)).mul(D(100).minus(disc)).div(100));
  }
  const dq = pct(invQty, totals.qty);
  const da = pct(invAmount, totals.amount);
  const differences: ReceiptMatchDifference[] = [
    { kind: "QTY", invoice: Number(invQty.toDecimalPlaces(3)), receipts: Number(totals.qty.toDecimalPlaces(3)), diffPct: dq, tolerancePct: qtyTolerancePct, exceeded: checked && dq > qtyTolerancePct },
    { kind: "AMOUNT", invoice: Number(invAmount.toDecimalPlaces(2)), receipts: Number(totals.amount.toDecimalPlaces(2)), diffPct: da, tolerancePct: priceTolerancePct, exceeded: checked && da > priceTolerancePct },
  ];
  return { checked, qtyTolerancePct, priceTolerancePct, differences };
}

/** ONAY kapısı: bayrak açıkken tolerans dışı fark → 400 (Türkçe fark listesi + `details.differences`). */
export async function assertReceiptMatchTx(db: Db, docNo: string, args: Parameters<typeof receiptMatchTx>[1]): Promise<void> {
  const m = await receiptMatchTx(db, args);
  if (!m || !m.checked) return;
  const bad = m.differences.filter((d) => d.exceeded);
  if (bad.length === 0) return;
  const label = (d: ReceiptMatchDifference) => `${d.kind === "QTY" ? "miktar" : "tutar"} fatura ${d.invoice} ↔ fiş ${d.receipts} (fark %${d.diffPct}, tolerans %${d.tolerancePct})`;
  throw AppError.badRequest(`${docNo}: bağlı mal kabul fişleriyle uyuşmuyor — ${bad.map(label).join("; ")}. Faturayı ya da fişleri düzeltin.`, { code: INVOICE_RECEIPT_CODES.mismatch, differences: m.differences });
}
