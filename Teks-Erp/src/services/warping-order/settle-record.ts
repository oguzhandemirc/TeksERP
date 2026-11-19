// =============================================================================
// FASON DEVERE D5b — kapanış / yeniden açma KAYDI okuyucusu (kapanış yanıtı, replay, geçmiş listesi aynı fonksiyon)
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";

type Db = Pick<Prisma.TransactionClient, "warpingOrderSettlement" | "yarnMovement" | "warpingOrder">;
export const WARPING_SETTLE = "SETTLE" as const;
export const WARPING_REOPEN = "REOPEN" as const;
const kg = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v).toFixed(3);

const RECORD_SELECT = {
  id: true, warpingOrderId: true, kind: true, reason: true, wastePct: true, tolerancePct: true, overTolerance: true,
  returnMovementIds: true, backTransferIds: true, createdById: true, createdAt: true, reversesId: true,
  reversal: { select: { id: true, createdAt: true, reason: true } },
  wastes: {
    select: {
      id: true, kind: true, qtyKg: true, overTolerance: true, dispatchItemId: true, reversesId: true,
      dispatchItem: { select: { yarnItemId: true, lotId: true, lot: { select: { lotNo: true } }, yarnItem: { select: { code: true, name: true } }, dispatch: { select: { dispatchNo: true } } } },
    },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.WarpingOrderSettlementSelect;

export interface WarpingSettlementRecord {
  id: string; warpingOrderId: string; kind: string; reason: string | null;
  wastePct: string | null; tolerancePct: string | null; overTolerance: boolean;
  createdAt: string; createdById: string | null;
  /** SETTLE: yeniden açıldıysa REOPEN kaydı. */
  reopened: { id: string; createdAt: string; reason: string | null } | null;
  reversesId: string | null;
  totalWasteKg: string; totalReturnKg: string;
  wastes: Array<{ id: string; kind: string; dispatchItemId: string; dispatchNo: string; yarnItemId: string; code: string; name: string; lotNo: string | null; qtyKg: string; overTolerance: boolean; reversesId: string | null }>;
  returns: Array<{ movementId: string; dispatchItemId: string | null; yarnItemId: string; qtyKg: string; warehouseId: string; lotId: string | null; reasonCode: string | null }>;
  backTransferIds: string[];
}

type Row = Prisma.WarpingOrderSettlementGetPayload<{ select: typeof RECORD_SELECT }>;

async function toRecord(db: Db, r: Row): Promise<WarpingSettlementRecord> {
  const moves = r.returnMovementIds.length === 0 ? [] : await db.yarnMovement.findMany({
    where: { id: { in: r.returnMovementIds } },
    select: { id: true, dispatchItemId: true, itemId: true, qtyKg: true, warehouseId: true, lotId: true, reasonCode: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const totalWaste = r.wastes.reduce((s, w) => s.plus(w.qtyKg), new Prisma.Decimal(0));
  const totalReturn = moves.reduce((s, m) => s.plus(m.qtyKg), new Prisma.Decimal(0));
  return {
    id: r.id, warpingOrderId: r.warpingOrderId, kind: r.kind, reason: r.reason,
    wastePct: r.wastePct?.toFixed(2) ?? null, tolerancePct: r.tolerancePct?.toFixed(2) ?? null, overTolerance: r.overTolerance,
    createdAt: r.createdAt.toISOString(), createdById: r.createdById,
    reopened: r.reversal ? { id: r.reversal.id, createdAt: r.reversal.createdAt.toISOString(), reason: r.reversal.reason } : null,
    reversesId: r.reversesId,
    totalWasteKg: kg(totalWaste), totalReturnKg: kg(totalReturn),
    wastes: r.wastes.map((w) => ({
      id: w.id, kind: w.kind, dispatchItemId: w.dispatchItemId, dispatchNo: w.dispatchItem.dispatch.dispatchNo, yarnItemId: w.dispatchItem.yarnItemId ?? "",
      code: w.dispatchItem.yarnItem?.code ?? "", name: w.dispatchItem.yarnItem?.name ?? "", lotNo: w.dispatchItem.lot?.lotNo ?? null, qtyKg: kg(w.qtyKg), overTolerance: w.overTolerance, reversesId: w.reversesId,
    })),
    returns: moves.map((m) => ({ movementId: m.id, dispatchItemId: m.dispatchItemId, yarnItemId: m.itemId, qtyKg: kg(m.qtyKg), warehouseId: m.warehouseId, lotId: m.lotId, reasonCode: m.reasonCode })),
    backTransferIds: r.backTransferIds,
  };
}

export async function loadSettlementRecord(db: Db, settlementId: string): Promise<WarpingSettlementRecord> {
  const r = await sequentialTx(db).warpingOrderSettlement.findUnique({ where: { id: settlementId }, select: RECORD_SELECT });
  if (!r) throw AppError.notFound("Kapanış kaydı bulunamadı.", { code: "WARPING_SETTLEMENT_NOT_FOUND" });
  return toRecord(db, r);
}

/** Siparişin canlı (yeniden açılmamış) en yeni kapanışı — eşitlikte id. */
export async function newestLiveSettlement(db: Pick<Db, "warpingOrderSettlement">, warpingOrderId: string) {
  return db.warpingOrderSettlement.findFirst({
    where: { warpingOrderId, kind: WARPING_SETTLE, reversal: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, returnMovementIds: true, backTransferIds: true },
  });
}

/** Siparişin kapanış/yeniden açma geçmişi (eskiden yeniye). */
export async function listWarpingSettlements(id: string): Promise<WarpingSettlementRecord[]> {
  const exists = await prisma.warpingOrder.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const rows = await sequentialTx(prisma).warpingOrderSettlement.findMany({ where: { warpingOrderId: id }, select: RECORD_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const out: WarpingSettlementRecord[] = [];
  for (const r of rows) out.push(await toRecord(prisma, r));
  return out;
}
