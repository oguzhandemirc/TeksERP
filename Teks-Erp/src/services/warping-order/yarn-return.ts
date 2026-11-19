// =============================================================================
// FASON DEVERE — iplik İADESİNİN tx gövdesi + kaynak claim'i · deverecide duran iplik okuyucuları (D4b-2)
// (elle iade + fire + iade stornosu ucu: `yarn-return-waste.ts`)
// =============================================================================
// İade = mevcut `returnYarnTx` (SUBCONTRACT_RETURN; tek yazar `applyYarnMovementTx`, iplik kapısı orada). Tavan bu
// siparişin TUTMASI (holding). Aktarımla gelen kalemden iade: aynı tx'te kalemin kendi siparişine geri aktarım
// (TRANSFER) + iade — iplik defteri kalemin sevkine bağlı kalır. Kilit sırası: sipariş claim → kalem FOR UPDATE → stok.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { returnYarnTx, type ReturnYarnInput } from "../subcontractor-yarn.service";
import { loadWarpingYarnItems, lockDispatchItemsTx, WARPING_TRANSFER } from "../helpers/warping-yarn-open.helper";
import { listWarpingTransfers as listWarpingTransferBatches } from "./yarn-transfer-shared";
import { qtyText } from "../helpers/qty-text.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg = (v: Prisma.Decimal) => v.toFixed(3);
const HOLDERS = [WarpingOrderStatus.IN_PROGRESS, WarpingOrderStatus.COMPLETED];

export interface WarpingYarnReturnResult {
  movementId: string;
  dispatchItemId: string;
  dispatchNo: string;
  itemCode: string;
  qtyKg: string;
  /** Bu siparişin bu kalemden iade sonrası tuttuğu kg. */
  holdingKg: string;
  /** Aktarımla gelen kalemde yazılan geri aktarım belgesi. */
  backTransferBatchId: string | null;
}

/**
 * İadenin tx gövdesi — sipariş satırını ÇAĞIRAN claim eder (elle iade: aşağıda; D5b kapanış: `settle.ts`). Aktarımla
 * gelen kalemde geri aktarım + iade aynı tx'te.
 */
export async function returnWarpingYarnTx(tx: Prisma.TransactionClient, id: string, input: ReturnYarnInput, userId: string) {
  await lockDispatchItemsTx(tx, [input.dispatchItemId]);
  const it = (await loadWarpingYarnItems(tx, { warpingOrderId: id })).find((i) => i.dispatchItemId === input.dispatchItemId);
  if (!it || it.openKg.lte(0)) throw AppError.notFound("Bu sipariş bu sevk kaleminden iplik tutmuyor.", { code: "WARPING_YARN_NOT_HELD" });
  const qty = D(input.qtyKg).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (qty.gt(it.openKg)) {
    throw AppError.badRequest(`İade, siparişin deverecide tuttuğu ipliği aşamaz (tutulan ${qtyText(it.openKg)} kg, iade ${qtyText(qty)} kg).`, { code: "YARN_RETURN_EXCEEDS", holdingKg: kg(it.openKg) });
  }
  let backTransferBatchId: string | null = null;
  let backTransferId: string | null = null;
  if (!it.own && qty.gt(0)) {
    backTransferBatchId = randomUUID();
    const bt = await tx.warpingYarnTransfer.create({
      data: { dispatchItemId: it.dispatchItemId, fromWarpingOrderId: id, toWarpingOrderId: it.warpingOrderId, kind: WARPING_TRANSFER, qtyKg: qty, batchId: backTransferBatchId, note: "İade için geri aktarım", createdById: userId },
      select: { id: true },
    });
    backTransferId = bt.id;
  }
  const r = await returnYarnTx(tx, it.dispatchId, input, userId);
  return { r, it, backTransferBatchId, backTransferId, holding: it.openKg.minus(r.qty) };
}

/** İade/aktarma kaynağı claim'i — tx'in İLK ifadesi (sipariş satırı; kabul/sevk/kapanış aynı satırda sıraya girer). */
export async function claimReturnSourceTx(tx: Prisma.TransactionClient, id: string, userId: string): Promise<void> {
  const claim = await tx.warpingOrder.updateMany({ where: { id, status: { in: HOLDERS } }, data: { updatedById: userId } });
  if (claim.count === 1) return;
  const fresh = await tx.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true } });
  if (!fresh) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  throw AppError.conflict(`${fresh.orderNo} durumu ${fresh.status} — deverecide tuttuğu iplik yok, iade alınamaz.`, { code: "WARPING_RETURN_STATUS", status: fresh.status });
}

// ── Okuyucular ───────────────────────────────────────────────────────────────

/** Siparişin giren/çıkan aktarma ve storno belgeleri. */
export async function listWarpingTransfers(id: string) {
  const exists = await prisma.warpingOrder.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  return listWarpingTransferBatches(prisma, id);
}

/** Siparişin tuttuğu iplik, kalem kalem (iade/aktarma ekranının kaynağı). */
export async function listWarpingYarnHoldings(id: string) {
  const exists = await prisma.warpingOrder.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const items = await loadWarpingYarnItems(prisma, { warpingOrderId: id });
  return items.filter((i) => !i.openKg.isZero() || i.own).map((i) => ({
    dispatchItemId: i.dispatchItemId, dispatchId: i.dispatchId, dispatchNo: i.dispatchNo, dispatchedAt: i.dispatchedAt.toISOString(),
    ownWarpingOrderId: i.warpingOrderId, own: i.own, yarnItemId: i.yarnItemId, lotId: i.lotId, lotNo: i.lotNo, ownerCustomerId: i.ownerCustomerId,
    outKg: kg(i.own ? i.outKg : D(0)), returnedKg: kg(i.own ? i.returnedKg : D(0)), transferInKg: kg(i.transferInKg), transferOutKg: kg(i.transferOutKg), holdingKg: kg(i.openKg),
  }));
}

/** Deverecide duran iplik okuyucusu kendi dosyasında (Fasondaki İplik: lot süzgeci · arama · değer). */
export { warpingYarnAtSubcontractors } from "./yarn-at-subcontractor";
