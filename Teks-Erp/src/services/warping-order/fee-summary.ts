// =============================================================================
// DEVERE A1 — devere ücreti ÖZETİ ve fatura ADAYLARI (salt-okuma)
// =============================================================================
// Bütün sayılar `warping-fee.helper`dan (K2/K3). Fatura servisini İMPORT ETMEZ: sipariş router'ı (warping-order)
// yalnız bu modülü okur, ticaret/maliyet rejim kapılarına geçişli dokunuş doğmaz. Taslak üretimi `fee-invoice.ts`.
// =============================================================================
import { Prisma, type Currency, type WarpingFeeUnit } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readDevereReworkBillable, readFinanceEnabled } from "../system-setting.service";
import { loadWarpingOrderFeesTx, warpingFeeInvoiceState, type WarpingFeeInvoiceState, type WarpingOrderFee, type WarpingReceiptFee } from "../helpers/warping-fee.helper";

export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const money = (v: Prisma.Decimal | null) => (v === null ? null : v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));

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

export const reworkOpt = async () => ({ reworkBillable: await readDevereReworkBillable() });

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
