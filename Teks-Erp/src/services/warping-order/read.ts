// =============================================================================
// FASON DEVERE SİPARİŞİ — okuma (detay DTO + liste/cursor/özet TEK where'den)
// =============================================================================
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../../utils/cursor";
import { resolveRangeEnd, resolveRangeStart } from "../../constants/time";
import { isBeamCountOpen } from "./plan";
import { warpingOrderIdsByFeeState, type WarpingFeeInvoiceState } from "../helpers/warping-fee.helper";

type Db = Pick<Prisma.TransactionClient, "warpingOrder">;
const kg = (v: Prisma.Decimal) => v.toFixed(3);

export const WARPING_ORDER_SELECT = {
  id: true, orderNo: true, status: true, beamCount: true, targetLengthM: true, fixedWasteM: true, wasteTolerancePct: true,
  feeUnit: true, feeUnitPrice: true, feeCurrency: true, expectedReturnAt: true, notes: true,
  completedAt: true, cancelledAt: true, cancelReason: true, createdAt: true, updatedAt: true, createdById: true,
  warpSpec: { select: { id: true, code: true, name: true, sequenceNote: true, reedNo: true, reedWidthCm: true, endsPerDent: true, endsCount: true } },
  subcontractor: { select: { id: true, code: true, name: true } },
  beamLines: { select: { beamCount: true, beamLengthM: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
  extraSpecs: { select: { sortOrder: true, warpSpec: { select: { id: true, code: true, name: true } } }, orderBy: { sortOrder: "asc" } },
  salesOrders: { select: { order: { select: { id: true, orderNumber: true, status: true, customer: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "asc" } },
  yarns: {
    select: { yarnItemId: true, sourceWarpSpecId: true, endsCount: true, denier: true, wastePct: true, netKg: true, grossKg: true, sortOrder: true, yarnItem: { select: { code: true, name: true } } },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.WarpingOrderSelect;
type Row = Prisma.WarpingOrderGetPayload<{ select: typeof WARPING_ORDER_SELECT }>;

export interface WarpingOrderDto {
  id: string;
  orderNo: string;
  status: WarpingOrderStatus;
  warpSpec: { id: string; code: string; name: string; sequenceNote: string | null; reedNo: string | null; reedWidthCm: string | null; endsPerDent: number | null };
  subcontractor: { id: string; code: string; name: string };
  beamLines: Array<{ beamCount: number; beamLengthM: string }>;
  /** NULL = levent adedi belli değil (`beamLines` boş); eski istemci yalnız metinde gösterir. */
  beamCount: number | null;
  beamCountOpen: boolean;
  targetLengthM: string;
  extraSpecs: Array<{ id: string; code: string; name: string }>;
  salesOrders: Array<{ id: string; orderNumber: string; status: string; customerName: string }>;
  fixedWasteM: string;
  wasteTolerancePct: string | null;
  fee: { unit: string; unitPrice: string | null; currency: string | null };
  expectedReturnAt: string | null;
  notes: string | null;
  /** Herhangi bir fire girdisi > 0 mı — değilse panel "fireli" sütununu çizmez (net = brüt). */
  hasWaste: boolean;
  yarns: Array<{ yarnItemId: string; code: string; name: string; sourceWarpSpecId: string; endsCount: number; denier: string; wastePct: string; netKg: string; grossKg: string; letter: string }>;
  totals: { endsCount: number; netKg: string; grossKg: string };
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Talimattaki harf (A, B, … Z, AA …) — sıra `sortOrder`. */
export function yarnLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function toWarpingOrderDto(r: Row): WarpingOrderDto {
  let net = new Prisma.Decimal(0);
  let gross = new Prisma.Decimal(0);
  let ends = 0;
  for (const y of r.yarns) {
    net = net.plus(y.netKg);
    gross = gross.plus(y.grossKg);
    ends += y.endsCount;
  }
  return {
    id: r.id,
    orderNo: r.orderNo,
    status: r.status,
    warpSpec: {
      id: r.warpSpec.id, code: r.warpSpec.code, name: r.warpSpec.name, sequenceNote: r.warpSpec.sequenceNote,
      reedNo: r.warpSpec.reedNo?.toString() ?? null, reedWidthCm: r.warpSpec.reedWidthCm?.toString() ?? null, endsPerDent: r.warpSpec.endsPerDent,
    },
    subcontractor: r.subcontractor,
    beamLines: r.beamLines.map((l) => ({ beamCount: l.beamCount, beamLengthM: l.beamLengthM.toFixed(3) })),
    beamCount: r.beamCount,
    beamCountOpen: isBeamCountOpen(r.beamCount),
    targetLengthM: r.targetLengthM.toFixed(3),
    extraSpecs: r.extraSpecs.map((e) => e.warpSpec),
    salesOrders: r.salesOrders.map((s) => ({ id: s.order.id, orderNumber: s.order.orderNumber, status: s.order.status, customerName: s.order.customer.name })),
    fixedWasteM: r.fixedWasteM.toFixed(2),
    wasteTolerancePct: r.wasteTolerancePct?.toFixed(2) ?? null,
    fee: { unit: r.feeUnit, unitPrice: r.feeUnitPrice?.toString() ?? null, currency: r.feeCurrency },
    expectedReturnAt: r.expectedReturnAt?.toISOString() ?? null,
    notes: r.notes,
    hasWaste: r.fixedWasteM.gt(0) || r.yarns.some((y) => y.wastePct.gt(0)),
    yarns: r.yarns.map((y, i) => ({
      yarnItemId: y.yarnItemId, code: y.yarnItem.code, name: y.yarnItem.name, sourceWarpSpecId: y.sourceWarpSpecId, endsCount: y.endsCount,
      denier: y.denier.toString(), wastePct: y.wastePct.toFixed(2), netKg: kg(y.netKg), grossKg: kg(y.grossKg), letter: yarnLetter(i),
    })),
    totals: { endsCount: ends, netKg: kg(net), grossKg: kg(gross) },
    completedAt: r.completedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function loadWarpingOrderDto(db: Db, id: string): Promise<WarpingOrderDto> {
  const row = await db.warpingOrder.findUnique({ where: { id }, select: WARPING_ORDER_SELECT });
  if (!row) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  return toWarpingOrderDto(row);
}

export async function getWarpingOrder(id: string): Promise<WarpingOrderDto> {
  return loadWarpingOrderDto(prisma, id);
}

type IdCond = string | { in: string[] } | null;
export interface WarpingOrderListParams {
  status: WarpingOrderStatus[];
  subcontractorId: IdCond;
  warpSpecId: IdCond;
  salesOrderId: IdCond;
  /** Devere A1: fatura durumu (NONE · PARTIAL · FULL); boş = süzme yok. */
  feeInvoiced?: WarpingFeeInvoiceState[];
  /** `feeInvoiced`ten çözülen kimlikler (where kurucusu senkron kalır; `listWarpingOrders` doldurur). */
  feeOrderIds?: string[];
  from?: string;
  to?: string;
  search?: string;
  cursor?: string;
  limit: number;
}

/** Liste + cursor + özet şeridi TEK where'den; tarih süzgeci fabrika günü (`createdAt`). */
export function buildWarpingOrderListWhere(p: Omit<WarpingOrderListParams, "cursor" | "limit">): Prisma.WarpingOrderWhereInput {
  const where: Prisma.WarpingOrderWhereInput = {};
  if (p.status.length > 0) where.status = { in: p.status };
  if (p.subcontractorId) where.subcontractorId = p.subcontractorId;
  if (p.warpSpecId) where.warpSpecId = p.warpSpecId;
  if (p.salesOrderId) where.salesOrders = { some: { orderId: p.salesOrderId } };
  if (p.feeOrderIds) where.id = { in: p.feeOrderIds };
  if (p.from || p.to) where.createdAt = { ...(p.from ? { gte: resolveRangeStart(p.from) } : {}), ...(p.to ? { lte: resolveRangeEnd(p.to) } : {}) };
  const q = p.search?.trim();
  if (q) where.orderNo = { contains: q, mode: "insensitive" };
  return where;
}

export interface WarpingOrderListRow {
  id: string;
  orderNo: string;
  status: WarpingOrderStatus;
  warpSpec: { id: string; code: string; name: string };
  subcontractor: { id: string; name: string };
  beamCount: number | null;
  beamCountOpen: boolean;
  targetLengthM: string;
  expectedReturnAt: string | null;
  createdAt: string;
}

export async function listWarpingOrders(p: WarpingOrderListParams): Promise<{ data: WarpingOrderListRow[]; nextCursor: string | null; summary: { count: number; byStatus: Record<WarpingOrderStatus, number>; openTargetLengthM: string } }> {
  const feeOrderIds = p.feeInvoiced?.length ? await warpingOrderIdsByFeeState(prisma, p.feeInvoiced) : undefined;
  const where = buildWarpingOrderListWhere({ ...p, feeOrderIds });
  let cursor = null;
  if (p.cursor) {
    cursor = decodeCursor(p.cursor);
    if (!cursor) throw AppError.badRequest("Geçersiz sayfa imleci.", { code: "CURSOR_INVALID" });
  }
  const rows = await prisma.warpingOrder.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: p.limit + 1,
    select: {
      id: true, orderNo: true, status: true, beamCount: true, targetLengthM: true, expectedReturnAt: true, createdAt: true,
      warpSpec: { select: { id: true, code: true, name: true } }, subcontractor: { select: { id: true, name: true } },
    },
  });
  const hasMore = rows.length > p.limit;
  const page = hasMore ? rows.slice(0, p.limit) : rows;
  const groups = await prisma.warpingOrder.groupBy({ by: ["status"], where, _count: { _all: true } });
  const openSum = await prisma.warpingOrder.aggregate({ where: { AND: [where, { status: { in: [WarpingOrderStatus.OPEN, WarpingOrderStatus.IN_PROGRESS] } }] }, _sum: { targetLengthM: true } });
  const byStatus = { OPEN: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 } as Record<WarpingOrderStatus, number>;
  for (const g of groups) byStatus[g.status] = g._count._all;
  return {
    data: page.map((r) => ({
      id: r.id, orderNo: r.orderNo, status: r.status, warpSpec: r.warpSpec, subcontractor: r.subcontractor, beamCount: r.beamCount, beamCountOpen: isBeamCountOpen(r.beamCount),
      targetLengthM: r.targetLengthM.toFixed(3), expectedReturnAt: r.expectedReturnAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? buildNextCursor(page[page.length - 1]) : null,
    summary: {
      count: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      openTargetLengthM: (openSum._sum.targetLengthM ?? new Prisma.Decimal(0)).toFixed(3),
    },
  };
}
