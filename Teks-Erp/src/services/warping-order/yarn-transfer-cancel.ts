// =============================================================================
// FASON DEVERE — aktarma STORNOSU (önizlemeli, D4b-2)
// =============================================================================
// Belge başına: aktarma belgesinin her TRANSFER satırına bir TRANSFER_CANCEL (`reversesId`, tek ters — çift storno DB'de
// imkânsız). Hedef sipariş o kalemden aktarılan kg'yi HÂLÂ tutmuyorsa (iade etti / başka siparişe aktardı) 409 — LIFO.
// Hedefin canlı sevki ve aktarma bakiyesi kalmazsa `IN_PROGRESS → OPEN` (plan yeniden düzenlenebilir).
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { loadWarpingYarnItems, lockDispatchItemsTx, WARPING_TRANSFER, WARPING_TRANSFER_CANCEL } from "../helpers/warping-yarn-open.helper";
import { WARPING_ORDER_TABLE } from "./create";
import { loadTransferBatch, type WarpingTransferBatch } from "./yarn-transfer-shared";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const HOLDERS = [WarpingOrderStatus.IN_PROGRESS, WarpingOrderStatus.COMPLETED];

/**
 * Aktarma (`transfer`) ve stornosu (`cancel`) iki siparişi `id` sırasıyla claim eder — tx'in İLK ifadeleri; iki yönlü
 * eşzamanlı aktarma (A→B, B→A) aynı sırada kilitlendiği için kilitlenmez. Aktarmada hedef `OPEN → IN_PROGRESS`.
 */
export async function claimTransferOrdersTx(tx: Tx, a: { sourceId: string; targetId: string; userId: string; mode?: "transfer" | "cancel" }): Promise<{ targetWasOpen: boolean }> {
  const mode = a.mode ?? "transfer";
  let targetWasOpen = false;
  for (const id of [a.sourceId, a.targetId].sort()) {
    const isTarget = id === a.targetId;
    if (isTarget && mode === "transfer") {
      const opened = await tx.warpingOrder.updateMany({ where: { id, status: WarpingOrderStatus.OPEN }, data: { status: WarpingOrderStatus.IN_PROGRESS, updatedById: a.userId } });
      targetWasOpen = opened.count === 1;
      if (targetWasOpen) continue;
    }
    // Stornoda yalnız kilit: OPEN da kabul (hüküm tutmaya bakar — zaten stornolu ya da tüketilmiş ayrımı tanılı kalsın).
    const allowed = mode === "cancel" ? [WarpingOrderStatus.OPEN, ...HOLDERS] : isTarget ? [WarpingOrderStatus.IN_PROGRESS] : HOLDERS;
    const claim = await tx.warpingOrder.updateMany({ where: { id, status: { in: allowed } }, data: { updatedById: a.userId } });
    if (claim.count === 1) continue;
    const fresh = await tx.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true } });
    if (!fresh) {
      if (isTarget) throw AppError.badRequest("Hedef devere siparişi bulunamadı.", { code: "WARPING_TRANSFER_TARGET_NOT_FOUND" });
      throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
    }
    throw AppError.conflict(
      isTarget ? `Hedef ${fresh.orderNo} durumu ${fresh.status} — iplik aktarılamaz (açık ya da devam eden sipariş olmalı).` : `${fresh.orderNo} durumu ${fresh.status} — deverecide tuttuğu iplik yok, aktarılamaz.`,
      { code: isTarget ? "WARPING_TRANSFER_TARGET_STATUS" : "WARPING_TRANSFER_SOURCE_STATUS", status: fresh.status },
    );
  }
  return { targetWasOpen };
}


export interface WarpingTransferCancelPreview {
  batch: WarpingTransferBatch;
  canCancel: boolean;
  blockedReason: string | null;
  /** Etkilenen her kalem: geri dönecek kg ↔ hedefin bugün tuttuğu kg. */
  items: Array<{ dispatchItemId: string; dispatchNo: string; code: string; name: string; lotNo: string | null; qtyKg: string; targetHoldsKg: string }>;
}

async function ownBatch(db: Pick<Tx, "warpingYarnTransfer">, id: string, batchId: string): Promise<WarpingTransferBatch> {
  const batch = await loadTransferBatch(db, batchId);
  if (batch.fromWarpingOrderId !== id && batch.toWarpingOrderId !== id) throw AppError.notFound("Bu siparişte böyle bir aktarma yok.", { code: "WARPING_TRANSFER_NOT_FOUND" });
  return batch;
}

/** Hüküm (önizleme ve yazım aynı yüklem): storno türü 400 · zaten stornolu 409 · hedef tutmuyorsa 409. */
async function verdict(db: Pick<Tx, "subcontractorDispatchItem">, batch: WarpingTransferBatch) {
  const holds = new Map((await loadWarpingYarnItems(db, { warpingOrderId: batch.toWarpingOrderId })).map((i) => [i.dispatchItemId, i.openKg]));
  const need = new Map<string, Prisma.Decimal>();
  for (const r of batch.rows) need.set(r.dispatchItemId, (need.get(r.dispatchItemId) ?? D(0)).plus(r.qtyKg));
  const items = batch.rows.map((r) => ({ dispatchItemId: r.dispatchItemId, dispatchNo: r.dispatchNo, code: r.code, name: r.name, lotNo: r.lotNo, qtyKg: r.qtyKg, targetHoldsKg: (holds.get(r.dispatchItemId) ?? D(0)).toFixed(3) }));
  if (batch.kind !== WARPING_TRANSFER) return { items, blocked: { status: 400, code: "WARPING_TRANSFER_NOT_REVERSIBLE", msg: "Storno belgesi geri alınamaz — gerekirse yeni aktarma yapın." } };
  if (batch.cancelled) return { items, blocked: { status: 409, code: "WARPING_TRANSFER_ALREADY_CANCELLED", msg: "Bu aktarma zaten iptal edilmiş." } };
  const short = [...need].find(([itemId, q]) => (holds.get(itemId) ?? D(0)).lt(q));
  if (short) {
    return { items, blocked: { status: 409, code: "WARPING_TRANSFER_CONSUMED", msg: `${batch.toOrderNo} aktarılan ipliğin bir kısmını artık tutmuyor (iade edildi ya da yeniden aktarıldı) — önce o işlemi geri alın (LIFO).` } };
  }
  return { items, blocked: null };
}

export async function previewCancelWarpingTransfer(id: string, batchId: string): Promise<WarpingTransferCancelPreview> {
  const batch = await ownBatch(prisma, id, batchId);
  const v = await verdict(prisma, batch);
  return { batch, canCancel: v.blocked === null, blockedReason: v.blocked?.msg ?? null, items: v.items };
}

export async function cancelWarpingTransfer(id: string, batchId: string, reason: string, userId: string): Promise<WarpingTransferBatch & { targetStatus: WarpingOrderStatus }> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı.");
  // Kaynak/hedef değişmez gerçektir: kilit sırasını bilmek için tx dışında okunur, tx içinde TAZE yeniden okunur.
  const head = await ownBatch(prisma, id, batchId);
  const out = await prisma.$transaction(async (tx) => {
    await claimTransferOrdersTx(tx, { sourceId: head.fromWarpingOrderId, targetId: head.toWarpingOrderId, userId, mode: "cancel" });
    await lockDispatchItemsTx(tx, head.rows.map((r) => r.dispatchItemId));
    const batch = await loadTransferBatch(tx, batchId);
    const v = await verdict(tx, batch);
    if (v.blocked) throw v.blocked.status === 400 ? AppError.badRequest(v.blocked.msg, { code: v.blocked.code }) : AppError.conflict(v.blocked.msg, { code: v.blocked.code });
    const cancelBatchId = randomUUID();
    for (const r of batch.rows) {
      await tx.warpingYarnTransfer.create({
        data: {
          dispatchItemId: r.dispatchItemId, fromWarpingOrderId: batch.fromWarpingOrderId, toWarpingOrderId: batch.toWarpingOrderId,
          kind: WARPING_TRANSFER_CANCEL, qtyKg: r.qtyKg, reversesId: r.transferId, batchId: cancelBatchId, note: why, createdById: userId,
        },
      });
    }
    let targetStatus: WarpingOrderStatus = WarpingOrderStatus.IN_PROGRESS;
    const live = await tx.subcontractorDispatch.count({ where: { warpingOrderId: batch.toWarpingOrderId, cancelledAt: null } });
    const rest = await loadWarpingYarnItems(tx, { warpingOrderId: batch.toWarpingOrderId });
    if (live === 0 && rest.every((i) => i.transferInKg.isZero() && i.transferOutKg.isZero())) {
      const back = await tx.warpingOrder.updateMany({ where: { id: batch.toWarpingOrderId, status: WarpingOrderStatus.IN_PROGRESS }, data: { status: WarpingOrderStatus.OPEN, updatedById: userId } });
      if (back.count === 1) targetStatus = WarpingOrderStatus.OPEN;
    }
    const fresh = await tx.warpingOrder.findUnique({ where: { id: batch.toWarpingOrderId }, select: { status: true } });
    return { batch, cancelBatchId, targetStatus: targetStatus === WarpingOrderStatus.OPEN ? targetStatus : fresh!.status };
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: out.batch.fromWarpingOrderId, newData: { yarnTransferCancelled: batchId, cancelBatchId: out.cancelBatchId, toWarpingOrderId: out.batch.toWarpingOrderId, totalKg: out.batch.totalKg, reason: why } });
  await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: out.batch.toWarpingOrderId, newData: { yarnTransferCancelled: batchId, cancelBatchId: out.cancelBatchId, fromWarpingOrderId: out.batch.fromWarpingOrderId, totalKg: out.batch.totalKg, reason: why, ...(out.targetStatus === WarpingOrderStatus.OPEN ? { status: WarpingOrderStatus.OPEN } : {}) } });
  return { ...(await loadTransferBatch(prisma, out.cancelBatchId)), targetStatus: out.targetStatus };
}
