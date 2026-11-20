// =============================================================================
// FASON DEVERE — OTOMATİK KAPANIŞ: deverecide iplik kalmayınca sipariş aynı tx'te kapanır (kullanıcı kararı 2026-11-19)
// =============================================================================
// Tetikleyen: iade(+fire) ve aktarma (kaynak sipariş) — tutmayı kullanıcı eliyle sıfırlayan yazımlar. Levent kabulü
// tetiklemez: nominal tüketim tutmayı sıfırlayabilir ama sonraki levent/sevk beklenir (kapanış kabulü 409'a düşürürdü).
// Koşul: bütün kalemlerde tutma 0 + kapanış yüklemi (`settleBlockers`) boş. Kayıt mevcut kapanışın aynısı (SETTLE,
// iade/fire satırı yok — kalan 0); geri alma bugünkü `reopen.ts`. Çağıran siparişi tx başında claim etmiş olmalı.
// =============================================================================
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import { AuditService } from "../audit.service";
import { WARPING_ORDER_TABLE } from "./create";
import { WARPING_SETTLE } from "./settle-record";
import { claimForSettleTx, evaluateSettle, settleBlockers } from "./settle";
import { settleRequestHash } from "../helpers/warping-settle-plan.helper";

type Tx = Prisma.TransactionClient;

export type AutoSettleTrigger = "YARN_RETURN" | "YARN_TRANSFER";
export interface AutoSettled { warpingOrderId: string; settlementId: string; trigger: AutoSettleTrigger; wastePct: string | null; overTolerance: boolean }

export const AUTO_SETTLE_REASON = "Otomatik kapanış — deverecide iplik kalmadı";

/** Kalan sıfırsa ve kapanış yüklemi izin veriyorsa kapatır; aksi hâlde hiçbir şey yazmaz (null). */
export async function autoSettleIfDrainedTx(tx: Tx, id: string, userId: string, trigger: AutoSettleTrigger): Promise<AutoSettled | null> {
  const o = await tx.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true, wasteTolerancePct: true } });
  if (!o || o.status !== WarpingOrderStatus.IN_PROGRESS) return null;
  const body = { lines: [] };
  const ev = await evaluateSettle(tx, id, body, { tolerance: o.wasteTolerancePct });
  if (ev.items.some((i) => i.openKg.gt(0))) return null;
  if (settleBlockers(o, ev).length > 0) return null;
  await claimForSettleTx(tx, id, userId);
  const s = await tx.warpingOrderSettlement.create({
    data: {
      warpingOrderId: id, kind: WARPING_SETTLE, clientToken: null, requestHash: settleRequestHash(body), reason: AUTO_SETTLE_REASON,
      wastePct: ev.plan.wastePct, tolerancePct: ev.plan.tolerancePct, overTolerance: ev.plan.overTolerance,
      returnMovementIds: [], backTransferIds: [], createdById: userId,
    },
    select: { id: true },
  });
  return { warpingOrderId: id, settlementId: s.id, trigger, wastePct: ev.plan.wastePct?.toFixed(2) ?? null, overTolerance: ev.plan.overTolerance };
}

/** Otomatik kapanışın ayak izi (tx DIŞINDA) — elle kapanıştan `auto: true` + tetikleyiciyle ayrılır. */
export async function logAutoSettle(a: AutoSettled | null, userId: string): Promise<void> {
  if (!a) return;
  await AuditService.log({
    userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: a.warpingOrderId,
    oldData: { status: WarpingOrderStatus.IN_PROGRESS },
    newData: { status: WarpingOrderStatus.COMPLETED, settlementId: a.settlementId, auto: true, trigger: a.trigger, returnKg: "0.000", wasteKg: "0.000", keepKg: "0.000", wastePct: a.wastePct, overTolerance: a.overTolerance, reason: AUTO_SETTLE_REASON },
  });
}
