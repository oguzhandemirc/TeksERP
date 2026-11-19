// =============================================================================
// FASON DEVERE SİPARİŞİ — KAPANIŞ STORNOSU / YENİDEN AÇMA (D5b)
// =============================================================================
// Tek tx: sipariş CLAIM'i İLK ifade (`COMPLETED → IN_PROGRESS`) → canlı en yeni SETTLE → etkilenen kalemler `FOR UPDATE`
// `id` sırasıyla → REOPEN satırı (`reversesId`, tek ters) → her WASTE'e WASTE_CANCEL → kapanış iadelerine
// SUBCONTRACT_RETURN_CANCEL (sondan başa; ayrıca storno edilmiş iade atlanır) → geri aktarımlara TRANSFER_CANCEL.
// İleri satırlar değişmez; ters kayıt bugüne. "Kalır" kısmı başka siparişe devredilmiş olsa da geri alma serbesttir.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { cancelReturnWithWasteTx } from "./yarn-return-waste";
import { loadWarpingYarnItems, lockDispatchItemsTx, WARPING_TRANSFER_CANCEL, WARPING_WASTE } from "../helpers/warping-yarn-open.helper";
import { WARPING_ORDER_TABLE } from "./create";
import { reverseWastesTx } from "./waste-write";
import { loadSettlementRecord, newestLiveSettlement, WARPING_REOPEN, type WarpingSettlementRecord } from "./settle-record";
import { qtyText } from "../helpers/qty-text.helper";

type Tx = Prisma.TransactionClient;
const kg = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v).toFixed(3);

async function loadReopenScope(db: Tx | typeof prisma, settlementId: string) {
  const wastes = await db.warpingYarnWaste.findMany({
    where: { settlementId, kind: WARPING_WASTE, reversal: null },
    select: { id: true, dispatchItemId: true, qtyKg: true, warpingOrderId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const s = await db.warpingOrderSettlement.findUniqueOrThrow({ where: { id: settlementId }, select: { returnMovementIds: true, backTransferIds: true } });
  const returns = s.returnMovementIds.length === 0 ? [] : await db.yarnMovement.findMany({
    where: { id: { in: s.returnMovementIds } },
    select: { id: true, dispatchItemId: true, qtyKg: true, dispatchItem: { select: { dispatchId: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const transfers = s.backTransferIds.length === 0 ? [] : await db.warpingYarnTransfer.findMany({
    where: { id: { in: s.backTransferIds }, reversal: null },
    select: { id: true, dispatchItemId: true, fromWarpingOrderId: true, toWarpingOrderId: true, qtyKg: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return { wastes, returns, transfers };
}

export interface WarpingReopenPreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus };
  canReopen: boolean;
  blockers: string[];
  /** Geri alınacak kapanış (eski/elle kapanmış siparişte null — yalnız durum döner). */
  settlement: WarpingSettlementRecord | null;
  /** Storno edilecek kayıtlar — her biri ayrı listelenir. */
  wastesToCancel: Array<{ wasteId: string; dispatchItemId: string; qtyKg: string }>;
  returnsToCancel: Array<{ movementId: string; dispatchItemId: string | null; qtyKg: string }>;
  transfersToCancel: Array<{ transferId: string; dispatchItemId: string; qtyKg: string }>;
}

export async function previewReopenWarpingOrder(id: string): Promise<WarpingReopenPreview> {
  const o = await prisma.warpingOrder.findUnique({ where: { id }, select: { id: true, orderNo: true, status: true } });
  if (!o) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const blockers = o.status === WarpingOrderStatus.COMPLETED ? [] : [`${o.orderNo} durumu ${o.status} — yalnız kapanmış sipariş yeniden açılır.`];
  const live = await newestLiveSettlement(prisma, id);
  const scope = live ? await loadReopenScope(prisma, live.id) : { wastes: [], returns: [], transfers: [] };
  return {
    order: o, canReopen: blockers.length === 0, blockers,
    settlement: live ? await loadSettlementRecord(prisma, live.id) : null,
    wastesToCancel: scope.wastes.map((w) => ({ wasteId: w.id, dispatchItemId: w.dispatchItemId, qtyKg: kg(w.qtyKg) })),
    returnsToCancel: scope.returns.map((r) => ({ movementId: r.id, dispatchItemId: r.dispatchItemId, qtyKg: kg(r.qtyKg) })),
    transfersToCancel: scope.transfers.map((t) => ({ transferId: t.id, dispatchItemId: t.dispatchItemId, qtyKg: kg(t.qtyKg) })),
  };
}

async function claimForReopenTx(tx: Tx, id: string, userId: string): Promise<void> {
  const claim = await tx.warpingOrder.updateMany({
    where: { id, status: WarpingOrderStatus.COMPLETED },
    data: { status: WarpingOrderStatus.IN_PROGRESS, completedAt: null, completedById: null, updatedById: userId },
  });
  if (claim.count === 1) return;
  const o = await tx.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true } });
  if (!o) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  throw AppError.conflict(`${o.orderNo} durumu ${o.status} — yalnız kapanmış sipariş yeniden açılır.`, { code: "WARPING_ORDER_NOT_COMPLETED", status: o.status });
}

/** Geri aktarımın tersi — hedefin (kalemin kendi siparişi) tutması yetmiyorsa 409. */
async function cancelBackTransferTx(tx: Tx, t: { id: string; dispatchItemId: string; fromWarpingOrderId: string; toWarpingOrderId: string; qtyKg: Prisma.Decimal }, userId: string) {
  const held = (await loadWarpingYarnItems(tx, { warpingOrderId: t.toWarpingOrderId })).find((i) => i.dispatchItemId === t.dispatchItemId)?.openKg ?? new Prisma.Decimal(0);
  if (held.lt(t.qtyKg)) {
    throw AppError.conflict(`Geri aktarım geri alınamaz — iplik kalemin kendi siparişinde artık yok (tutulan ${qtyText(held)} kg, gereken ${qtyText(t.qtyKg)} kg).`, { code: "WARPING_REOPEN_TRANSFER_HELD" });
  }
  await tx.warpingYarnTransfer.create({
    data: {
      dispatchItemId: t.dispatchItemId, fromWarpingOrderId: t.fromWarpingOrderId, toWarpingOrderId: t.toWarpingOrderId, kind: WARPING_TRANSFER_CANCEL,
      qtyKg: t.qtyKg, reversesId: t.id, batchId: randomUUID(), note: "Kapanış stornosu — iade geri aktarımı geri alındı", createdById: userId,
    },
  });
}

export interface WarpingReopenResult {
  orderId: string;
  status: WarpingOrderStatus;
  reopenId: string | null;
  settlementId: string | null;
  wastesCancelled: number;
  returnsCancelled: string[];
  returnsSkipped: string[];
  transfersCancelled: number;
}

export async function reopenWarpingOrder(id: string, reason: string, userId: string): Promise<WarpingReopenResult> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("Yeniden açma sebebi en az 3 karakter olmalı.");
  const out = await prisma.$transaction(async (tx) => {
    await claimForReopenTx(tx, id, userId);
    const live = await newestLiveSettlement(tx, id);
    if (!live) return { reopenId: null, settlementId: null, wastes: 0, cancelled: [] as string[], skipped: [] as string[], transfers: 0 };
    const scope = await loadReopenScope(tx, live.id);
    await lockDispatchItemsTx(tx, [...scope.wastes.map((w) => w.dispatchItemId), ...scope.returns.map((r) => r.dispatchItemId ?? ""), ...scope.transfers.map((t) => t.dispatchItemId)].filter(Boolean));
    const reopen = await tx.warpingOrderSettlement.create({
      data: { warpingOrderId: id, kind: WARPING_REOPEN, reversesId: live.id, reason: why, returnMovementIds: [], backTransferIds: [], createdById: userId },
      select: { id: true },
    });
    await reverseWastesTx(tx, { src: { settlementId: reopen.id }, wastes: scope.wastes, reason: why, userId });
    const cancelled: string[] = [];
    const skipped: string[] = [];
    for (const r of scope.returns) {
      if (!r.dispatchItemId || !r.dispatchItem) continue;
      try {
        await cancelReturnWithWasteTx(tx, r.dispatchItem.dispatchId, { dispatchItemId: r.dispatchItemId, movementId: r.id, reason: `Kapanış stornosu: ${why}` }, userId);
        cancelled.push(r.id);
      } catch (e) {
        // Kullanıcı kapanış iadesini ayrıca storno etmişse (grup net'i yetmez) atlanır; başka her hata tx'i düşürür.
        if ((e as { details?: { code?: string } }).details?.code !== "YARN_RETURN_NOT_OPEN") throw e;
        skipped.push(r.id);
      }
    }
    for (const t of scope.transfers) await cancelBackTransferTx(tx, t, userId);
    return { reopenId: reopen.id, settlementId: live.id, wastes: scope.wastes.length, cancelled, skipped, transfers: scope.transfers.length };
  });
  await AuditService.log({
    userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id,
    oldData: { status: WarpingOrderStatus.COMPLETED },
    newData: { status: WarpingOrderStatus.IN_PROGRESS, reopenId: out.reopenId, settlementId: out.settlementId, wastesCancelled: out.wastes, returnsCancelled: out.cancelled, returnsSkipped: out.skipped, transfersCancelled: out.transfers, reason: why },
  });
  return {
    orderId: id, status: WarpingOrderStatus.IN_PROGRESS, reopenId: out.reopenId, settlementId: out.settlementId,
    wastesCancelled: out.wastes, returnsCancelled: out.cancelled, returnsSkipped: out.skipped, transfersCancelled: out.transfers,
  };
}
