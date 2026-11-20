// =============================================================================
// FASON DEVERE — siparişin SEVK listesi (D6-be; salt okuma, panel D6b)
// =============================================================================
// İptal edilmiş sevkler DAHİL (durumuyla); kalem rakamları `warping-yarn-open` tek okuyucusundan (BRÜT çıkış, net iade,
// net aktarım, canlı dağıtım). "İptal edilebilir mi" = sipariş IN_PROGRESS + sevk iptalinin LIFO engeli
// (`warpingDispatchCancelBlock`, önizleme ile aynı tanım). Sipariş başına sevk sayısı sınırlıdır → sayfalama yok.
// =============================================================================
import { Prisma, SubcontractorDispatchItemKind, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { toWarpingYarnItem, WARPING_YARN_ITEM_SELECT, woundOfItem, type WarpingYarnItem } from "../helpers/warping-yarn-open.helper";
import { warpingDispatchCancelBlock } from "./dispatch-cancel";
import { dispatchBeamBodyCancelBlock, loadDispatchBeamBodies, type DispatchBeamBodyRef } from "../beam-body/dispatch-link";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg = (v: Prisma.Decimal) => v.toFixed(3);
const countSum = (xs: Array<number | null>) => (xs.some((x) => x !== null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);

export interface WarpingDispatchListItem {
  dispatchItemId: string;
  yarnItemId: string;
  yarnItemCode: string;
  yarnItemName: string;
  warehouseId: string;
  warehouseName: string | null;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  /** BRÜT çıkış. */
  outKg: string;
  /** Net iade (iade − iade stornosu). */
  returnedKg: string;
  /** Bu siparişten başka siparişe aktarılan (storno düşülmüş). */
  transferOutKg: string;
  /** Başka siparişten bu kaleme geri aktarılan (ör. hedefin iadesi için geri aktarım). */
  transferInKg: string;
  /** Bu siparişin tutmasından dönen leventlere sarılan (canlı; fire HARİÇ — `woundOfItem`). */
  allocatedKg: string;
  /** Bu siparişin bu kalemden yazdığı net fire (kapanış + iade penceresi; mutabakat Fire'ı ile aynı alan). */
  wasteKg: string;
  /** Bu siparişin bu kalemden bugün tuttuğu (iptal edilmiş sevkte 0). */
  holdingKg: string;
  /** H1: koli / bobin adedi — bilgi (defter değil); girilmediyse null. */
  packageCount: number | null;
  bobbinCount: number | null;
}

export interface WarpingDispatchListRow {
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: string;
  status: "ACTIVE" | "CANCELLED";
  cancelledAt: string | null;
  cancelReason: string | null;
  goodsReceiptId: string | null;
  totalOutKg: string;
  totalReturnedKg: string;
  totalTransferOutKg: string;
  totalTransferInKg: string;
  totalAllocatedKg: string;
  totalWasteKg: string;
  totalHoldingKg: string;
  /** H1: Σ koli / bobin (girilen kalemler); hiçbiri girilmediyse null. */
  totalPackageCount: number | null;
  totalBobbinCount: number | null;
  canCancel: boolean;
  cancelBlockedReason: string | null;
  items: WarpingDispatchListItem[];
  /** B2: sevkle giden boş levent gövdeleri (irsaliyeye basılır); gövde takibi hiç kullanılmadıysa boş. */
  beamBodies: DispatchBeamBodyRef[];
}

export async function listWarpingDispatches(id: string): Promise<WarpingDispatchListRow[]> {
  const order = await prisma.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true } });
  if (!order) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const heads = await prisma.subcontractorDispatch.findMany({
    where: { warpingOrderId: id },
    select: { id: true, dispatchNo: true, dispatchedAt: true, cancelledAt: true, cancelReason: true, goodsReceiptId: true },
    orderBy: [{ dispatchedAt: "asc" }, { id: "asc" }],
  });
  if (heads.length === 0) return [];
  const rows = await sequentialTx(prisma).subcontractorDispatchItem.findMany({
    where: { kind: SubcontractorDispatchItemKind.YARN, dispatchId: { in: heads.map((h) => h.id) } },
    select: { ...WARPING_YARN_ITEM_SELECT, packageCount: true, bobbinCount: true, yarnItem: { select: { code: true, name: true } }, warehouse: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byDispatch = new Map<string, Array<{ it: WarpingYarnItem; code: string; name: string; warehouseName: string | null; packageCount: number | null; bobbinCount: number | null }>>();
  for (const r of rows) {
    const list = byDispatch.get(r.dispatch.id) ?? [];
    list.push({ it: toWarpingYarnItem(r), code: r.yarnItem?.code ?? "", name: r.yarnItem?.name ?? "", warehouseName: r.warehouse?.name ?? null, packageCount: r.packageCount, bobbinCount: r.bobbinCount });
    byDispatch.set(r.dispatch.id, list);
  }
  const bodies = await loadDispatchBeamBodies(prisma, heads.map((h) => h.id));
  // Gövde engeli (sevkten sonra hareket etmiş gövde) yalnız gövdeli canlı sevkte ölçülür — iptal önizlemesiyle aynı tanım.
  const bodyBlocks = new Map<string, string | null>();
  for (const h of heads) if (!h.cancelledAt && bodies.has(h.id)) bodyBlocks.set(h.id, await dispatchBeamBodyCancelBlock(prisma, h.id));
  const statusBlock = order.status === WarpingOrderStatus.IN_PROGRESS ? null : `${order.orderNo} durumu ${order.status} — sevk iptal edilemez.`;
  return heads.map((h) => {
    const list = byDispatch.get(h.id) ?? [];
    const cancelled = h.cancelledAt !== null;
    const blocked = warpingDispatchCancelBlock(h.cancelledAt, list.map((x) => x.it)) ?? statusBlock ?? bodyBlocks.get(h.id) ?? null;
    const items = list.map(({ it, code, name, warehouseName, packageCount, bobbinCount }) => {
      return {
        dispatchItemId: it.dispatchItemId, yarnItemId: it.yarnItemId, yarnItemCode: code, yarnItemName: name,
        warehouseId: it.warehouseId, warehouseName, lotId: it.lotId, lotNo: it.lotNo, ownerCustomerId: it.ownerCustomerId,
        outKg: it.outKg, returnedKg: it.returnedKg, transferOutKg: it.transferOutKg, transferInKg: it.transferInKg, allocatedKg: woundOfItem(it), wasteKg: it.wasteKg,
        holdingKg: cancelled ? D(0) : it.openKg, packageCount, bobbinCount,
      };
    });
    const sum = (k: "outKg" | "returnedKg" | "transferOutKg" | "transferInKg" | "allocatedKg" | "wasteKg" | "holdingKg") => kg(items.reduce((a, x) => a.plus(x[k]), D(0)));
    return {
      dispatchId: h.id, dispatchNo: h.dispatchNo, dispatchedAt: h.dispatchedAt.toISOString(),
      status: cancelled ? "CANCELLED" : "ACTIVE", cancelledAt: h.cancelledAt?.toISOString() ?? null, cancelReason: h.cancelReason,
      goodsReceiptId: h.goodsReceiptId,
      totalOutKg: sum("outKg"), totalReturnedKg: sum("returnedKg"), totalTransferOutKg: sum("transferOutKg"), totalTransferInKg: sum("transferInKg"),
      totalAllocatedKg: sum("allocatedKg"), totalWasteKg: sum("wasteKg"), totalHoldingKg: sum("holdingKg"),
      totalPackageCount: countSum(items.map((x) => x.packageCount)), totalBobbinCount: countSum(items.map((x) => x.bobbinCount)),
      canCancel: blocked === null, cancelBlockedReason: blocked,
      beamBodies: bodies.get(h.id) ?? [],
      items: items.map((x) => ({
        ...x, outKg: kg(x.outKg), returnedKg: kg(x.returnedKg), transferOutKg: kg(x.transferOutKg), transferInKg: kg(x.transferInKg), allocatedKg: kg(x.allocatedKg), wasteKg: kg(x.wasteKg), holdingKg: kg(x.holdingKg),
      })),
    };
  });
}
