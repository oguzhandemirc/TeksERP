// =============================================================================
// EMANET ÇIKIŞ BELGESİ — okuma (detay DTO + liste/cursor/özet tek where'den)
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../../utils/cursor";
import { resolveRangeEnd, resolveRangeStart } from "../../constants/time";
import type { ConsignmentDispatchDto, ConsignmentDispatchItemDto, ConsignmentDispatchListResult } from "./types";

type Db = Pick<Prisma.TransactionClient, "consignmentDispatch" | "user">;

export const CONSIGNMENT_DISPATCH_SELECT = {
  id: true, dispatchNo: true, dispatchedAt: true, dispatchedById: true, plateNumber: true, driverName: true, notes: true,
  cancelledAt: true, cancelReason: true, updatedAt: true,
  ownerCustomer: { select: { id: true, code: true, name: true } },
  items: {
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, kind: true, lengthM: true, qtyKg: true,
      warpBeam: { select: { id: true, beamNo: true, warpSpec: { select: { name: true } } } },
      yarnItem: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      lot: { select: { id: true, lotNo: true } },
    },
  },
} satisfies Prisma.ConsignmentDispatchSelect;

type Row = Prisma.ConsignmentDispatchGetPayload<{ select: typeof CONSIGNMENT_DISPATCH_SELECT }>;

function toItemDto(i: Row["items"][number]): ConsignmentDispatchItemDto {
  return {
    id: i.id,
    kind: i.kind,
    warpBeam: i.warpBeam ? { id: i.warpBeam.id, beamNo: i.warpBeam.beamNo, warpSpecName: i.warpBeam.warpSpec?.name ?? null } : null,
    lengthM: i.lengthM ? i.lengthM.toFixed(3) : null,
    yarnItem: i.yarnItem ? { id: i.yarnItem.id, code: i.yarnItem.code, name: i.yarnItem.name } : null,
    warehouse: i.warehouse ? { id: i.warehouse.id, name: i.warehouse.name } : null,
    lot: i.lot ? { id: i.lot.id, lotNo: i.lot.lotNo } : null,
    qtyKg: i.qtyKg ? i.qtyKg.toFixed(3) : null,
  };
}

function totalsOf(items: Row["items"]): ConsignmentDispatchDto["totals"] {
  let beamCount = 0;
  let beamLengthM = new Prisma.Decimal(0);
  let yarnKg = new Prisma.Decimal(0);
  for (const i of items) {
    if (i.kind === "WARP_BEAM") {
      beamCount += 1;
      beamLengthM = beamLengthM.plus(i.lengthM ?? 0);
    } else yarnKg = yarnKg.plus(i.qtyKg ?? 0);
  }
  return { beamCount, beamLengthM: beamLengthM.toFixed(3), yarnKg: yarnKg.toFixed(3) };
}

export interface ConsignmentDispatchDetail extends ConsignmentDispatchDto {
  /** İptal önizlemesi/iptal için bayatlık damgası (sözleşme `expectedUpdatedAt`). */
  updatedAt: string;
}

export async function loadConsignmentDispatchDto(db: Db, id: string): Promise<ConsignmentDispatchDetail> {
  const row = await db.consignmentDispatch.findUnique({ where: { id }, select: CONSIGNMENT_DISPATCH_SELECT });
  if (!row) throw AppError.notFound("Emanet çıkış belgesi bulunamadı.", { code: "CONSIGNMENT_DISPATCH_NOT_FOUND" });
  const user = row.dispatchedById ? await db.user.findUnique({ where: { id: row.dispatchedById }, select: { id: true, fullName: true } }) : null;
  return {
    id: row.id,
    dispatchNo: row.dispatchNo,
    ownerCustomer: { id: row.ownerCustomer.id, code: row.ownerCustomer.code, name: row.ownerCustomer.name },
    dispatchedAt: row.dispatchedAt.toISOString(),
    dispatchedBy: user ? { id: user.id, name: user.fullName } : null,
    plateNumber: row.plateNumber,
    driverName: row.driverName,
    notes: row.notes,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    items: row.items.map(toItemDto),
    totals: totalsOf(row.items),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getConsignmentDispatch(id: string): Promise<ConsignmentDispatchDetail> {
  return loadConsignmentDispatchDto(prisma, id);
}

export interface ConsignmentDispatchListParams {
  ownerCustomerId: string | { in: string[] } | null;
  status: "ACTIVE" | "CANCELLED" | "ALL";
  from?: string;
  to?: string;
  search?: string;
  cursor?: string;
  limit: number;
}

/** Liste + cursor + özet şeridi TEK where'den; tarih süzgeci fabrika günü sınırı (`dispatchedAt`). */
export function buildConsignmentListWhere(p: Omit<ConsignmentDispatchListParams, "cursor" | "limit">): Prisma.ConsignmentDispatchWhereInput {
  const where: Prisma.ConsignmentDispatchWhereInput = {};
  if (p.ownerCustomerId) where.ownerCustomerId = p.ownerCustomerId;
  if (p.status === "ACTIVE") where.cancelledAt = null;
  if (p.status === "CANCELLED") where.cancelledAt = { not: null };
  if (p.from || p.to) {
    where.dispatchedAt = { ...(p.from ? { gte: resolveRangeStart(p.from) } : {}), ...(p.to ? { lte: resolveRangeEnd(p.to) } : {}) };
  }
  const q = p.search?.trim();
  if (q) where.dispatchNo = { contains: q, mode: "insensitive" };
  return where;
}

export async function listConsignmentDispatches(p: ConsignmentDispatchListParams): Promise<ConsignmentDispatchListResult> {
  const where = buildConsignmentListWhere(p);
  let cursor = null;
  if (p.cursor) {
    cursor = decodeCursor(p.cursor);
    if (!cursor) throw AppError.badRequest("Geçersiz sayfa imleci.", { code: "CURSOR_INVALID" });
  }
  const rows = await prisma.consignmentDispatch.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: p.limit + 1,
    select: { id: true, dispatchNo: true, dispatchedAt: true, cancelledAt: true, createdAt: true, ownerCustomer: { select: { id: true, name: true } } },
  });
  const hasMore = rows.length > p.limit;
  const page = hasMore ? rows.slice(0, p.limit) : rows;
  const pageTotals = page.length === 0 ? [] : await prisma.consignmentDispatchItem.groupBy({
    by: ["dispatchId", "kind"],
    where: { dispatchId: { in: page.map((r) => r.id) } },
    _count: { _all: true },
    _sum: { lengthM: true, qtyKg: true },
  });
  const byDispatch = new Map<string, { beamCount: number; beamLengthM: Prisma.Decimal; yarnKg: Prisma.Decimal }>();
  for (const g of pageTotals) {
    const t = byDispatch.get(g.dispatchId) ?? { beamCount: 0, beamLengthM: new Prisma.Decimal(0), yarnKg: new Prisma.Decimal(0) };
    if (g.kind === "WARP_BEAM") {
      t.beamCount += g._count._all;
      t.beamLengthM = t.beamLengthM.plus(g._sum.lengthM ?? 0);
    } else t.yarnKg = t.yarnKg.plus(g._sum.qtyKg ?? 0);
    byDispatch.set(g.dispatchId, t);
  }
  const count = await prisma.consignmentDispatch.count({ where });
  const activeCount = await prisma.consignmentDispatch.count({ where: { AND: [where, { cancelledAt: null }] } });
  const activeItems = await prisma.consignmentDispatchItem.groupBy({
    by: ["kind"],
    where: { dispatch: { AND: [where, { cancelledAt: null }] } },
    _count: { _all: true },
    _sum: { qtyKg: true },
  });
  const beamCount = activeItems.find((g) => g.kind === "WARP_BEAM")?._count._all ?? 0;
  const yarnKg = activeItems.find((g) => g.kind === "YARN")?._sum.qtyKg ?? new Prisma.Decimal(0);
  return {
    data: page.map((r) => {
      const t = byDispatch.get(r.id);
      return {
        id: r.id,
        dispatchNo: r.dispatchNo,
        ownerCustomer: { id: r.ownerCustomer.id, name: r.ownerCustomer.name },
        dispatchedAt: r.dispatchedAt.toISOString(),
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        beamCount: t?.beamCount ?? 0,
        beamLengthM: (t?.beamLengthM ?? new Prisma.Decimal(0)).toFixed(3),
        yarnKg: (t?.yarnKg ?? new Prisma.Decimal(0)).toFixed(3),
      };
    }),
    nextCursor: hasMore ? buildNextCursor(page[page.length - 1]) : null,
    summary: { count, activeCount, beamCount, yarnKg: new Prisma.Decimal(yarnKg).toFixed(3) },
  };
}
