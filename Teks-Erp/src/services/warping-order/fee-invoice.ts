// =============================================================================
// DEVERE A1 — devereci FATURASI: aday listesi · siparişten taslak · sipariş ücret özeti
// =============================================================================
// Bütün sayılar `warping-fee.helper`dan (K2/K3); bağ yazımı `invoiceService.createDraft` (kilit + kapılar
// `invoice-warping-receipts.helper`). Taslak sipariş başına TEK satır; hizmet kartı deverecinin aktif tarifesinden
// (METRE→RAW_M, KG→KG; yoksa açıklama satırı + uyarı). Fatura bilgisi yalnız `finance:read` ∧ ön muhasebe açıkken döner.
// =============================================================================
import { Currency, FinishingBasis, InvoiceLineType, InvoiceType, Prisma, WarpingFeeUnit } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import type { ApiResponse } from "../../types/api.types";
import { readDevereReworkBillable, readFinanceEnabled } from "../system-setting.service";
import { WARPING_FEE_LINE_UNIT, loadWarpingOrderFeesTx, warpingFeeInvoiceState, type WarpingFeeInvoiceState, type WarpingOrderFee, type WarpingReceiptFee } from "../helpers/warping-fee.helper";
import { resolveInvoiceTaxDefaults, taxLineFields } from "../helpers/invoice-tax-defaults.helper";
import { deriveInvoiceDueDate, findCariAccountForCardTx } from "../helpers/finance.helper";
import { invoiceService } from "../invoice.service";
import { warpingFeeMatchTx } from "../helpers/invoice-warping-receipts.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal | null) => (v === null ? null : v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));

export interface WarpingFeeReceiptDto {
  receiptKey: string; deliveryNoteNo: string | null; receivedAt: string; beamCount: number; lengthM: string; qty: string;
  expectedAmount: string | null;
  invoice: { id: string; docNo: string; status: string } | null;
  /** Aday listesinde: bu faturaya bağlanabilir mi (faturasız ya da düzenlenen faturanın kendisi). */
  selectable?: boolean;
}
export interface WarpingFeeOrderDto {
  id: string; orderNo: string; status: string; warpSpecName: string; subcontractor: { id: string; name: string };
  fee: { unit: WarpingFeeUnit; unitPrice: string | null; currency: Currency | null };
  receipts: WarpingFeeReceiptDto[];
  totals: { lengthM: string; qty: string; expectedAmount: string | null };
  /** NONE · PARTIAL · FULL; kabul yoksa ya da fatura bilgisi okunamıyorsa null. */
  invoiceState: WarpingFeeInvoiceState | null;
}

function receiptDto(r: WarpingReceiptFee, withInvoice: boolean): WarpingFeeReceiptDto {
  return {
    receiptKey: r.receiptKey, deliveryNoteNo: r.deliveryNoteNo, receivedAt: r.receivedAt.toISOString(), beamCount: r.beamCount,
    lengthM: r.lengthM.toFixed(3), qty: r.qty.toFixed(3), expectedAmount: money(r.expectedAmount),
    invoice: withInvoice && r.invoice ? { id: r.invoice.id, docNo: r.invoice.docNo, status: r.invoice.status } : null,
  };
}

function orderDto(o: WarpingOrderFee, withInvoice: boolean, selectableFor?: string | null): WarpingFeeOrderDto {
  const sum = (f: (r: WarpingReceiptFee) => Prisma.Decimal) => o.receipts.reduce((s, r) => s.plus(f(r)), D(0));
  return {
    id: o.id, orderNo: o.orderNo, status: o.status, warpSpecName: o.warpSpecName, subcontractor: { id: o.subcontractor.id, name: o.subcontractor.name },
    fee: { unit: o.feeUnit, unitPrice: o.feeUnitPrice?.toString() ?? null, currency: o.feeCurrency },
    receipts: o.receipts.map((r) => ({
      ...receiptDto(r, withInvoice),
      ...(selectableFor !== undefined ? { selectable: r.invoice === null || r.invoice.id === selectableFor } : {}),
    })),
    totals: { lengthM: sum((r) => r.lengthM).toFixed(3), qty: sum((r) => r.qty).toFixed(3), expectedAmount: o.feeUnitPrice ? money(sum((r) => r.expectedAmount ?? D(0))) : null },
    invoiceState: withInvoice ? warpingFeeInvoiceState(o.receipts) : null,
  };
}

/** Fatura ↔ beklenen devere ücreti (route kapısı; hesap helper'da). */
export const warpingFeeMatch = (invoiceId: string) => warpingFeeMatchTx(prisma, invoiceId);

const reworkOpt = async () => ({ reworkBillable: await readDevereReworkBillable() });

/** Sipariş sayfası "Devere ücreti" özeti — fatura bilgisi yalnız izinli + finans açıkken. */
export async function getWarpingOrderFeeSummary(id: string, opts: { canReadInvoices: boolean }): Promise<WarpingFeeOrderDto> {
  const [o] = await loadWarpingOrderFeesTx(prisma, { orderIds: [id] }, await reworkOpt());
  if (!o) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  return orderDto(o, opts.canReadInvoices && (await readFinanceEnabled()));
}

/** Carinin deverecisine ait, kabul edilen sarımı olan siparişler (fatura formu seçicisi). */
export async function listWarpingInvoiceCandidates(params: { cariId: string; invoiceId?: string | null }): Promise<WarpingFeeOrderDto[]> {
  const cari = await prisma.cariAccount.findUnique({ where: { id: params.cariId }, select: { customerId: true, subcontractorId: true } });
  if (!cari) throw AppError.notFound("Cari hesap bulunamadı.", { code: "CARI_NOT_FOUND" });
  const or: Prisma.SubcontractorWhereInput[] = [];
  if (cari.customerId) or.push({ customerId: cari.customerId });
  if (cari.subcontractorId) or.push({ id: cari.subcontractorId });
  if (or.length === 0) return [];
  const orders = await prisma.warpingOrder.findMany({ where: { subcontractor: { OR: or }, status: { not: "CANCELLED" } }, select: { id: true } });
  const fees = await loadWarpingOrderFeesTx(prisma, { orderIds: orders.map((o) => o.id) }, await reworkOpt());
  return fees.filter((o) => o.receipts.length > 0).map((o) => orderDto(o, true, params.invoiceId ?? null));
}

export interface WarpingDraftInput { warpingOrderIds?: string[]; receiptKeys?: string[]; clientToken: string }

/**
 * Siparişlerden (faturasız bütün kabuller) ya da seçili kabullerden ALIŞ taslağı. Replay: aynı token'ın faturasına bağlı
 * kabuller seçilebilir sayılır → satırlar aynı çıkar, `createDraft` replay boğazı mevcut taslağı döner.
 */
export async function createWarpingInvoiceDraft(input: WarpingDraftInput, userId?: string): Promise<ApiResponse<{ id: string; docNo: string }>> {
  if (!!input.warpingOrderIds?.length === !!input.receiptKeys?.length) {
    throw AppError.badRequest("Ya devere siparişleri ya da kabuller seçilmeli (ikisi birden değil).", { code: "WARPING_DRAFT_SCOPE_INVALID" });
  }
  const fees = await loadWarpingOrderFeesTx(prisma, input.receiptKeys ? { receiptKeys: input.receiptKeys } : { orderIds: input.warpingOrderIds }, await reworkOpt());
  const free = (r: WarpingReceiptFee) => r.invoice === null || r.invoice.clientToken === input.clientToken;
  const picked = fees.map((o) => ({ o, rs: o.receipts.filter((r) => (input.receiptKeys ? input.receiptKeys.includes(r.receiptKey) : free(r))) })).filter((x) => x.rs.length > 0);
  if (input.receiptKeys && picked.reduce((n, x) => n + x.rs.length, 0) !== new Set(input.receiptKeys).size) {
    throw AppError.badRequest("Seçilen kabullerden bazıları bulunamadı ya da bütün leventleri geri alınmış.", { code: "WARPING_RECEIPT_NOT_LINKABLE" });
  }
  if (picked.length === 0) throw AppError.conflict("Seçilen siparişlerde faturalanacak kabul yok (hepsi faturalı ya da kabul yok).", { code: "WARPING_NOTHING_TO_INVOICE" });
  const subs = new Set(picked.map((x) => x.o.subcontractor.id));
  if (subs.size > 1) throw AppError.badRequest("Seçilen siparişler farklı deverecilere ait — bir fatura tek devereciye kesilir.", { code: "WARPING_RECEIPT_PARTY_MISMATCH" });
  const sub = picked[0]!.o.subcontractor;
  if (!sub.customerId) throw AppError.conflict(`"${sub.name}" fason profili bir cari karta bağlı değil — önce fason firmayı kartına bağlayın.`, { code: "SUBCONTRACTOR_NOT_LINKED_TO_CARD" });
  const currencies = new Set(picked.map((x) => x.o.feeCurrency).filter((c): c is Currency => c !== null));
  if (currencies.size > 1) throw AppError.badRequest("Seçilen siparişlerin ücret para birimleri farklı — ayrı faturalar kesin.", { code: "WARPING_FEE_CURRENCY_MIXED" });
  const currency = [...currencies][0] ?? Currency.TRY;

  const warnings: string[] = [];
  const tax = taxLineFields(await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, customerId: sub.customerId, purchaseContext: "SUBCONTRACT" }));
  const rates = await prisma.finishingRate.findMany({
    where: { subcontractorId: sub.id, revokedAt: null, serviceItemId: { not: null } },
    select: { basis: true, serviceItemId: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const basisOf: Partial<Record<WarpingFeeUnit, FinishingBasis>> = { METRE: FinishingBasis.RAW_M, KG: FinishingBasis.KG };
  const lines = picked.map(({ o, rs }) => {
    const serviceItemId = rates.find((r) => r.basis === basisOf[o.feeUnit])?.serviceItemId ?? null;
    if (!o.feeUnitPrice) warnings.push(`${o.orderNo} siparişinde devere ücreti yok — satır fiyatsız geldi.`);
    const notes = [...new Set(rs.map((r) => r.deliveryNoteNo).filter((n): n is string => !!n))];
    const qty = rs.reduce((s, r) => s.plus(r.qty), D(0));
    const unit = WARPING_FEE_LINE_UNIT[o.feeUnit];
    const base = `Devere ücreti — ${o.orderNo} ${o.warpSpecName}${notes.length ? ` · irsaliye ${notes.join(", ")}` : ""}`;
    // Fatura satırı birim fiyatı 4 ondalık taşır; tel×m fiyatı (8 ondalık) yuvarlanırsa tutar kayar → götürü satır, ölçü açıklamada.
    const lump = o.feeUnitPrice !== null && o.feeUnitPrice.decimalPlaces() > 4;
    return {
      lineType: serviceItemId ? InvoiceLineType.SERVICE : InvoiceLineType.TEXT,
      serviceItemId,
      description: (lump ? `${base} · ${qty.toFixed(3)} ${unit} × ${o.feeUnitPrice!.toString()}` : base).slice(0, 300),
      qty: lump ? "1.000" : qty.toFixed(3),
      unit: lump ? "götürü" : unit,
      unitPrice: lump ? rs.reduce((s, r) => s.plus(r.expectedAmount ?? 0), D(0)).toFixed(4) : (o.feeUnitPrice ?? D(0)).toFixed(4),
      ...tax,
    };
  });
  if (lines.some((l) => l.lineType === InvoiceLineType.TEXT)) warnings.push("Deverecinin aktif tarifesinde hizmet kartı yok — satır açıklama satırı olarak geldi; tarifeye hizmet kartı bağlayın.");
  const issueDate = new Date();
  const cari = await findCariAccountForCardTx(prisma, { customerId: sub.customerId, subcontractorId: null }, { paymentTermDays: true });
  const created = await invoiceService.createDraft({
    type: InvoiceType.PURCHASE, customerId: sub.customerId, currency, issueDate, dueDate: deriveInvoiceDueDate(issueDate, cari?.paymentTermDays),
    notes: `Devere siparişlerinden üretildi: ${picked.map((x) => x.o.orderNo).join(", ")}`.slice(0, 500),
    warpingReceiptKeys: picked.flatMap((x) => x.rs.map((r) => r.receiptKey)), clientToken: input.clientToken, lines,
  }, userId);
  return warnings.length > 0 ? { ...created, warnings: [...(created.warnings ?? []), ...warnings] } : created;
}
