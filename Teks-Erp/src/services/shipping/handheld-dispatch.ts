// =============================================================================
// Shipping Service / handheld-dispatch — el terminali: A5 çuvala elle kg · A6 sevk et (sarmalayıcı)
// =============================================================================
// A6 eski `dispatchShipment`in yerine geçmez: aynı `performDispatchTx` çekirdeğini çağırır, önüne yalnız
// boş çuval düşürme (K8) + bayat ekran kapısı (`expectedRollCount`) ekler. İdempotency durum tabanlı (K3).
// =============================================================================
import { LoadUnitKind, Prisma, ShipmentStatus } from "@prisma/client";

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { weightWarning } from "../helpers/measurement-threshold.helper";
import { readSackSeqStart } from "../helpers/sack-seq.helper";
import { touchShipmentPlannedTx } from "../helpers/shipment-locks.helper";
import { assertManualWeightAllowed } from "../helpers/shipping-weigh-gate.helper";
import { readShippingManualWeightRestrictedEnabled } from "../system-setting.service";
import { type AllocationAuditTrail, type ShippingServiceThis } from "./shared";
import { assertHandheldEnabled, getHandheldLoadState, lockLiveUnitsTx, type HandheldLoadState, type LiveUnit } from "./handheld-state";
import { writeSackWeightTx } from "./sack-weigh";

type Tx = Prisma.TransactionClient;

/** A5 — çuvala elle kg (null = kaldır). Durum-idempotent: aynı kg tekrar gelirse defter satırı yazılmaz. */
export async function setSackWeightInShipment(
  shipmentId: string,
  sackId: string,
  body: { weightKg: number | null },
  ctx: { userId?: string; permissions?: string[] },
): Promise<{ state: HandheldLoadState; warning: string | null }> {
  await assertHandheldEnabled();
  if (body.weightKg !== null) {
    assertManualWeightAllowed({ restricted: await readShippingManualWeightRestrictedEnabled(), permissions: ctx.permissions ?? [] });
  }
  const sh = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true } });
  if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
  const written = await prisma.$transaction(async (tx) => {
    await touchShipmentPlannedTx(tx, shipmentId);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sacks WHERE id = ${sackId}::uuid AND "shipmentId" = ${shipmentId}::uuid
        AND "unitKind" = 'SACK' AND "dissolvedAt" IS NULL FOR UPDATE`;
    if (rows.length !== 1) throw AppError.conflict("Bu çuval bu sevkiyatta değil — ekranı yenileyin.", { code: "SACK_NOT_IN_SHIPMENT" });
    return writeSackWeightTx(tx, { sackId, weightKg: body.weightKg, source: "MANUAL", userId: ctx.userId, skipIfSame: true });
  });
  const warning = body.weightKg !== null ? weightWarning(body.weightKg) : null;
  if (written !== "NOOP") {
    await AuditService.log({ userId: ctx.userId, action: "UPDATE", tableName: "SACK", recordId: sackId, newData: { kind: "HANDHELD_WEIGH", event: written, shipmentId, weightKg: body.weightKg, source: "MANUAL", ...(warning ? { thresholdWarning: warning } : {}) } });
  }
  return { state: await getHandheldLoadState(shipmentId), warning };
}

export interface HandheldDispatchResult {
  shipmentId: string;
  shipmentNo: string;
  documentNo: string | null;
  rollCount: number;
  sackCount: number;
  looseRollCount: number;
  droppedEmptySacks: string[];
  state: HandheldLoadState;
  replayed?: true;
}

/**
 * Boş canlı çuvalları düşürür (K8). Defteri olan (tartı · tahsis · iz · depo hareketi) çuval SİLİNMEZ,
 * havuza döner: silmek ölçüm/hareket geçmişini (cascade/SetNull) yok ederdi. Döner: düşen çuval numaraları.
 */
async function dropEmptySacksTx(tx: Tx, live: LiveUnit[]): Promise<string[]> {
  const dropped: string[] = [];
  for (const u of live.filter((x) => x.unitKind === LoadUnitKind.SACK)) {
    if ((await tx.roll.count({ where: { sackId: u.id } })) > 0) continue;
    if ((await tx.swatch.count({ where: { sackId: u.id } })) > 0) continue;
    // Kalıcı silme yalnız "deftere hiç yazmamış taslak" sınıfı: FK'lı ve FK'sız (SwatchEvent · RollReturn) her başvuru sayılır.
    const ledger = (await tx.sackWeighing.count({ where: { sackId: u.id } }))
      // ⚠️ `clearedAt` SÜZÜLMEZ (bilinçli): soru "bu çuvala HİÇ tahsis yazıldı mı" — temizlenmiş tahsis de geçmiştir.
      + (await tx.sackAllocation.count({ where: { sackId: u.id } }))
      + (await tx.sackTagAssignment.count({ where: { sackId: u.id } }))
      + (await tx.warehouseMovement.count({ where: { sackId: u.id } }))
      + (await tx.swatchEvent.count({ where: { sackId: u.id } }))
      + (await tx.rollReturn.count({ where: { prevSackId: u.id } }));
    if (ledger > 0) {
      await tx.sack.updateMany({ where: { id: u.id }, data: { shipmentId: null, seq: null, labelDirty: true } });
    } else {
      await tx.sack.delete({ where: { id: u.id } });
    }
    dropped.push(u.sackNo);
  }
  return dropped;
}

/** Düşen çuvalların bıraktığı sıra boşluklarını kapatır (etiket "2/3" doğru kalsın); değişen birim etiketi kirlenir. */
async function renumberSeqTx(tx: Tx, shipmentId: string): Promise<void> {
  const units = await tx.sack.findMany({ where: { shipmentId, dissolvedAt: null }, orderBy: [{ seq: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, seq: true } });
  const start = await readSackSeqStart(tx);
  if (units.every((u, i) => u.seq === start + i)) return;
  await tx.sack.updateMany({ where: { id: { in: units.map((u) => u.id) } }, data: { seq: null } });
  for (let i = 0; i < units.length; i++) {
    const changed = units[i]!.seq !== start + i;
    await tx.sack.update({ where: { id: units[i]!.id }, data: { seq: start + i, ...(changed ? { labelDirty: true } : {}) } });
  }
}

async function dispatchResult(shipmentId: string, dropped: string[], replayed: boolean): Promise<HandheldDispatchResult> {
  const state = await getHandheldLoadState(shipmentId);
  return {
    shipmentId, shipmentNo: state.shipment.shipmentNo, documentNo: state.shipment.documentNo,
    rollCount: state.summary.rollCount, sackCount: state.summary.sackCount, looseRollCount: state.summary.looseRollCount,
    droppedEmptySacks: dropped, state, ...(replayed ? { replayed: true as const } : {}),
  };
}

/** A6 — sevk et. Tek tx: claim → birimler → boş çuval düşür → sayım kapısı → tartı → çekirdek sevk. */
export async function handheldDispatch(
  this: ShippingServiceThis,
  shipmentId: string,
  body: { plateNumber?: string | null; driverName?: string | null; expectedRollCount: number },
  userId?: string,
): Promise<HandheldDispatchResult> {
  await assertHandheldEnabled();
  const pre = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { status: true, dispatchedById: true } });
  if (!pre) throw AppError.notFound("Sevkiyat bulunamadı");
  if (pre.status === ShipmentStatus.DISPATCHED && userId && pre.dispatchedById === userId) return dispatchResult(shipmentId, [], true);
  if (pre.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Sevkiyat sevk edilmiş ya da iptal edilmiş.", { code: "SHIPMENT_NOT_PLANNED" });
  const trail: { iz: AllocationAuditTrail | null; dropped: string[]; flipped: number } = { iz: null, dropped: [], flipped: 0 };
  await prisma.$transaction(async (tx) => {
    await touchShipmentPlannedTx(tx, shipmentId);
    const live = await lockLiveUnitsTx(tx, shipmentId);
    trail.dropped = await dropEmptySacksTx(tx, live);
    if (trail.dropped.length > 0) await renumberSeqTx(tx, shipmentId);
    const rollCount = await tx.roll.count({ where: { shipmentId } });
    if (rollCount === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez — önce top okutun.", { code: "SHIPMENT_EMPTY" });
    if (rollCount !== body.expectedRollCount) {
      throw AppError.conflict(`Yük değişti (ekranda ${body.expectedRollCount}, sevkiyatta ${rollCount} top) — ekranı yenileyip tekrar onaylayın.`, { code: "LOAD_CHANGED", rollCount });
    }
    const sh = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { destination: true, sacks: { where: { dissolvedAt: null }, select: { sackNo: true, weightKg: true } } } });
    await this.assertWeighed(sh.sacks, sh.destination);
    const dp = await this.performDispatchTx(tx, shipmentId, { plateNumber: body.plateNumber, driverName: body.driverName }, userId);
    trail.iz = dp.iz;
    trail.flipped = dp.flipped;
  });
  await this.flushAllocationAudit(trail.iz, userId);
  await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "HANDHELD_DISPATCH", rollCount: trail.flipped, droppedEmptySacks: trail.dropped, plateNumber: body.plateNumber ?? null, driverName: body.driverName ?? null } });
  await this.maybeAutoDraftInvoiceAfterDispatch(shipmentId, userId);
  return dispatchResult(shipmentId, trail.dropped, false);
}
