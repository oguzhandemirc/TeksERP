// =============================================================================
// FASON DEVERE — K1: iplik tedarikçiden DOĞRUDAN devereciye (D4c)
// =============================================================================
// Mal kabul fişi `directWarpingOrderId` taşırsa her iplik satırı AYNI tx'te: IN (depo, lot, tedarikçi, fiyat izi)
// → bu siparişe devere sevki (SUBCONTRACT_OUT, aynı depo/lot; `SubcontractorDispatch.goodsReceiptId`). Depo net 0.
// Kilit sırası: fiş satırı → sipariş satırı (`claimForDispatchTx`) → kart 8030 SHARED → lot 8029 → stok satırı;
// elle sevk (sipariş → 8030 → stok) ve fiş iptali (fiş → sipariş) ile aynı yön, ABBA yok.
// Fiş iptali bağlı canlı sevkleri `cancelWarpingDispatchTx` ile (LIFO: iade alınmışsa 409) ters çevirir.
// =============================================================================
import { ItemType, Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { licenseModuleError } from "../../lib/license/module-ceiling";
import { settingScreenPath } from "../../constants/panel-ayar-yolu";
import { SETTING_KEYS, readDevereEnabled } from "../system-setting.service";
import { auditWarpingDispatch, claimForDispatchTx, dispatchClaimedWarpingOrderTx, type ClaimedWarpingOrder, type WarpingDispatchTxOut } from "./dispatch";
import { auditWarpingDispatchCancel, cancelWarpingDispatchTx, type WarpingDispatchCancelTxOut } from "./dispatch-cancel";

type Tx = Prisma.TransactionClient;
export const DIRECT_WARPING_PERMISSION = "warping-order:write";
export const DIRECT_WARPING_CANCEL_PERMISSION = "warping-order:cancel";
const DISPATCHABLE: WarpingOrderStatus[] = [WarpingOrderStatus.OPEN, WarpingOrderStatus.IN_PROGRESS];

/**
 * Hızlı yol (tx DIŞI, UX): devere modülü açık, sipariş sevk alabilir, satırların hepsi siparişin planındaki İPLİK.
 * Asıl sed satır tx'indeki sipariş claim'i ve `dispatchClaimedWarpingOrderTx` kapılarıdır.
 */
export async function assertDirectWarpingReceipt(warpingOrderId: string, lines: Array<{ itemId: string }>): Promise<void> {
  if (!(await readDevereEnabled())) {
    throw licenseModuleError(SETTING_KEYS.DEVERE_ENABLED, "Devere / levent") ?? AppError.forbidden(`Devere modülü bu kurulumda kapalı — iplik devere siparişine doğrudan alınamaz. ${settingScreenPath("modules")} ekranından açılabilir.`, { code: "MODULE_DISABLED", modul: "devere" });
  }
  const order = await prisma.warpingOrder.findUnique({
    where: { id: warpingOrderId },
    select: { orderNo: true, status: true, yarns: { select: { yarnItemId: true } } },
  });
  if (!order) throw AppError.badRequest("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  if (!DISPATCHABLE.includes(order.status)) {
    throw AppError.conflict(`${order.orderNo} durumu ${order.status} — doğrudan devere kabulü yapılamaz.`, { code: "WARPING_ORDER_NOT_DISPATCHABLE", status: order.status });
  }
  if (lines.length === 0) return;
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const items = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, itemType: true, name: true } });
  const nonYarn = items.find((i) => i.itemType !== ItemType.YARN);
  if (nonYarn) {
    throw AppError.badRequest(`Doğrudan devere fişine yalnız iplik satırı girer — "${nonYarn.name}" iplik değil; kumaş/sarf için ayrı fiş açın.`, { code: "DIRECT_WARPING_YARN_ONLY", itemId: nonYarn.id });
  }
  const plan = new Set(order.yarns.map((y) => y.yarnItemId));
  const off = items.find((i) => !plan.has(i.id));
  if (off) {
    throw AppError.badRequest(`"${off.name}" ${order.orderNo} siparişinin iplik planında yok — doğrudan devere fişine yalnız plandaki iplikler girer.`, { code: "WARPING_YARN_NOT_IN_PLAN", yarnItemId: off.id });
  }
}

/** Satır tx'inde fiş claim'inin HEMEN ardından — sipariş satırı kilidi kart/lot/stok kilitlerinden önce alınır. */
export function claimDirectWarpingOrderTx(tx: Tx, warpingOrderId: string, userId: string): Promise<ClaimedWarpingOrder> {
  return claimForDispatchTx(tx, warpingOrderId, userId);
}

/** IN satırı yazıldıktan sonra AYNI tx'te devere sevki: aynı depo, aynı lot, aynı kg. */
export function dispatchDirectReceiptLineTx(
  tx: Tx,
  order: ClaimedWarpingOrder,
  line: { goodsReceiptId: string; receiptNo: string; warehouseId: string; itemId: string; lotId: string | null; qtyKg: Prisma.Decimal },
  userId: string,
): Promise<WarpingDispatchTxOut> {
  return dispatchClaimedWarpingOrderTx(
    tx, order,
    { lines: [{ yarnItemId: line.itemId, warehouseId: line.warehouseId, lotId: line.lotId, qtyKg: line.qtyKg.toNumber() }], notes: `Tedarikçiden doğrudan devereciye — mal kabul ${line.receiptNo}` },
    { userId, goodsReceiptId: line.goodsReceiptId },
  );
}

export function auditDirectReceiptDispatch(warpingOrderId: string, out: WarpingDispatchTxOut, userId: string, goodsReceiptId: string): Promise<void> {
  return auditWarpingDispatch(warpingOrderId, out, userId, goodsReceiptId);
}

export interface DirectDispatchReversal { warpingOrderId: string; dispatchId: string; out: WarpingDispatchCancelTxOut }

/**
 * Fiş iptali: bağlı CANLI devere sevklerini ters çevirir (SUBCONTRACT_OUT_CANCEL → depo; ardından fişin ADJUST_OUT'u
 * depoyu net 0'a indirir). Sıra (sipariş, sevk) id'siyle belirlenimli. İade alınmış sevk 409 `YARN_ITEM_RETURNED`.
 */
export async function reverseDirectDispatchesTx(
  tx: Tx, { goodsReceiptId, why, userId, cancelAllowed }: { goodsReceiptId: string; why: string; userId: string | undefined; cancelAllowed: boolean },
): Promise<DirectDispatchReversal[]> {
  const live = await tx.subcontractorDispatch.findMany({
    where: { goodsReceiptId, cancelledAt: null },
    select: { id: true, dispatchNo: true, warpingOrderId: true },
    orderBy: [{ warpingOrderId: "asc" }, { id: "asc" }],
  });
  if (live.length === 0) return [];
  // Fiş claim'inden SONRA okunur: fiş CANCELLED olduğu için yeni doğrudan sevk doğamaz — küme kesin.
  if (!cancelAllowed) {
    throw AppError.forbidden(`Bu fişin iplikleri devereciye doğrudan sevk edilmiş (${live.map((d) => d.dispatchNo).join(", ")}) — iptal için '${DIRECT_WARPING_CANCEL_PERMISSION}' yetkisi gerekli.`, { code: "PERMISSION_DENIED", required: DIRECT_WARPING_CANCEL_PERMISSION });
  }
  if (!userId) throw AppError.unauthorized("Kimlik doğrulama gerekli.");
  const out: DirectDispatchReversal[] = [];
  for (const d of live) {
    if (!d.warpingOrderId) continue; // CHECK `subcontractor_dispatches_receipt_warping_ck` bunu imkânsız kılar
    out.push({ warpingOrderId: d.warpingOrderId, dispatchId: d.id, out: await cancelWarpingDispatchTx(tx, { id: d.warpingOrderId, dispatchId: d.id, why, userId }) });
  }
  return out;
}

export async function auditDirectDispatchReversals(rows: DirectDispatchReversal[], why: string, userId: string, goodsReceiptId: string): Promise<void> {
  for (const r of rows) await auditWarpingDispatchCancel({ id: r.warpingOrderId, dispatchId: r.dispatchId, why, userId }, r.out, goodsReceiptId);
}
