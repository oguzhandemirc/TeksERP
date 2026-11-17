// =============================================================================
// FASON DEVERE — kapanış DIŞINDA iplik İADESİ (sarmalayıcı) + iade stornosu · deverecide duran iplik okuyucuları (D4b-2)
// =============================================================================
// İade = mevcut `returnYarnTx` (SUBCONTRACT_RETURN; tek yazar `applyYarnMovementTx`, iplik kapısı orada). Tavan bu
// siparişin TUTMASI (holding). Aktarımla gelen kalemden iade: aynı tx'te kalemin kendi siparişine geri aktarım
// (TRANSFER) + iade — iplik defteri kalemin sevkine bağlı kalır. Kilit sırası: sipariş claim → kalem FOR UPDATE → stok.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { cancelYarnReturn, returnYarnTx, type ReturnYarnInput } from "../subcontractor-yarn.service";
import { loadWarpingYarnHoldings, loadWarpingYarnItems, lockDispatchItemsTx, WARPING_TRANSFER } from "../helpers/warping-yarn-open.helper";
import { WARPING_ORDER_TABLE } from "./create";
import { listWarpingTransfers as listWarpingTransferBatches } from "./yarn-transfer-shared";

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

export async function returnWarpingYarn(id: string, input: ReturnYarnInput, userId: string): Promise<WarpingYarnReturnResult> {
  const out = await prisma.$transaction(async (tx) => {
    const claim = await tx.warpingOrder.updateMany({ where: { id, status: { in: HOLDERS } }, data: { updatedById: userId } });
    if (claim.count === 0) {
      const fresh = await tx.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true } });
      if (!fresh) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
      throw AppError.conflict(`${fresh.orderNo} durumu ${fresh.status} — deverecide tuttuğu iplik yok, iade alınamaz.`, { code: "WARPING_RETURN_STATUS", status: fresh.status });
    }
    await lockDispatchItemsTx(tx, [input.dispatchItemId]);
    const it = (await loadWarpingYarnItems(tx, { warpingOrderId: id })).find((i) => i.dispatchItemId === input.dispatchItemId);
    if (!it || it.openKg.lte(0)) throw AppError.notFound("Bu sipariş bu sevk kaleminden iplik tutmuyor.", { code: "WARPING_YARN_NOT_HELD" });
    const qty = D(input.qtyKg).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
    if (qty.gt(it.openKg)) {
      throw AppError.badRequest(`İade, siparişin deverecide tuttuğu ipliği aşamaz (tutulan ${kg(it.openKg)} kg, iade ${kg(qty)} kg).`, { code: "YARN_RETURN_EXCEEDS", holdingKg: kg(it.openKg) });
    }
    let backTransferBatchId: string | null = null;
    if (!it.own && qty.gt(0)) {
      backTransferBatchId = randomUUID();
      await tx.warpingYarnTransfer.create({
        data: { dispatchItemId: it.dispatchItemId, fromWarpingOrderId: id, toWarpingOrderId: it.warpingOrderId, kind: WARPING_TRANSFER, qtyKg: qty, batchId: backTransferBatchId, note: "İade için geri aktarım", createdById: userId },
      });
    }
    const r = await returnYarnTx(tx, it.dispatchId, input, userId);
    return { r, it, backTransferBatchId, holding: it.openKg.minus(r.qty) };
  });
  const itemCode = out.r.item.yarnItem?.code ?? "";
  await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: out.it.dispatchId, newData: { yarnReturned: itemCode, dispatchItemId: input.dispatchItemId, qtyKg: kg(out.r.qty), reasonCode: input.reasonCode, movementId: out.r.movementId, warpingOrderId: id } });
  await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id, newData: { yarnReturned: itemCode, movementId: out.r.movementId, qtyKg: kg(out.r.qty), backTransferBatchId: out.backTransferBatchId } });
  return {
    movementId: out.r.movementId, dispatchItemId: input.dispatchItemId, dispatchNo: out.it.dispatchNo, itemCode,
    qtyKg: kg(out.r.qty), holdingKg: kg(out.holding), backTransferBatchId: out.backTransferBatchId,
  };
}

/** İade stornosu — mevcut `cancelYarnReturn`; dönen iplik kalemin KENDİ siparişinin tutmasına döner. */
export async function cancelWarpingYarnReturn(id: string, movementId: string, reason: string, userId: string) {
  const m = await prisma.yarnMovement.findUnique({
    where: { id: movementId },
    select: { id: true, dispatchItemId: true, dispatchItem: { select: { dispatchId: true, dispatch: { select: { warpingOrderId: true } }, warpingYarnTransfers: { where: { OR: [{ fromWarpingOrderId: id }, { toWarpingOrderId: id }] }, select: { id: true }, take: 1 } } } },
  });
  const item = m?.dispatchItem;
  const related = item && item.dispatch.warpingOrderId !== null && (item.dispatch.warpingOrderId === id || item.warpingYarnTransfers.length > 0);
  if (!m || !item || !related) throw AppError.notFound("Bu siparişte böyle bir iade satırı yok.", { code: "YARN_RETURN_NOT_FOUND" });
  const res = await cancelYarnReturn(item.dispatchId, { dispatchItemId: m.dispatchItemId!, movementId, reason }, userId);
  return res.data!;
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

/** Deverecide duran iplik — fasoncu × iplik × lot (× sipariş); `statuses` verilirse yalnız o durumdakiler. */
export async function warpingYarnAtSubcontractors(filter: { subcontractorIds?: string[]; yarnItemIds?: string[]; statuses?: WarpingOrderStatus[] }) {
  const rows = await loadWarpingYarnHoldings(prisma, filter);
  const groups = new Map<string, { subcontractorId: string; yarnItemId: string; lotId: string | null; lotNo: string | null; ownerCustomerId: string | null; kg: Prisma.Decimal; oldestDispatchedAt: Date; orders: Array<{ warpingOrderId: string; orderNo: string; status: WarpingOrderStatus; kg: string }> }>();
  for (const h of rows) {
    const k = `${h.subcontractorId}|${h.yarnItemId}|${h.lotId ?? ""}|${h.ownerCustomerId ?? ""}`;
    const g = groups.get(k) ?? { subcontractorId: h.subcontractorId, yarnItemId: h.yarnItemId, lotId: h.lotId, lotNo: h.lotNo, ownerCustomerId: h.ownerCustomerId, kg: D(0), oldestDispatchedAt: h.dispatchedAt, orders: [] };
    g.kg = g.kg.plus(h.kg);
    if (h.dispatchedAt < g.oldestDispatchedAt) g.oldestDispatchedAt = h.dispatchedAt;
    const o = g.orders.find((x) => x.warpingOrderId === h.warpingOrderId);
    if (o) o.kg = D(o.kg).plus(h.kg).toFixed(3);
    else g.orders.push({ warpingOrderId: h.warpingOrderId, orderNo: h.orderNo, status: h.orderStatus, kg: kg(h.kg) });
    groups.set(k, g);
  }
  // D6-be: ad alanları kimliklere EK (geriye uyumlu); sıralama kimlikle kalır.
  const list = [...groups.values()];
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const subIds = uniq(list.map((g) => g.subcontractorId));
  const yarnIds = uniq(list.map((g) => g.yarnItemId));
  const ownerIds = uniq(list.map((g) => g.ownerCustomerId).filter((x): x is string => x !== null));
  const subs = subIds.length > 0 ? await prisma.subcontractor.findMany({ where: { id: { in: subIds } }, select: { id: true, code: true, name: true } }) : [];
  const yarns = yarnIds.length > 0 ? await prisma.item.findMany({ where: { id: { in: yarnIds } }, select: { id: true, code: true, name: true } }) : [];
  const owners = ownerIds.length > 0 ? await prisma.customer.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  const subBy = new Map(subs.map((s) => [s.id, s]));
  const yarnBy = new Map(yarns.map((y) => [y.id, y]));
  const ownerBy = new Map(owners.map((o) => [o.id, o.name]));
  return list
    .sort((a, b) => a.subcontractorId.localeCompare(b.subcontractorId) || a.yarnItemId.localeCompare(b.yarnItemId) || (a.lotNo ?? "").localeCompare(b.lotNo ?? ""))
    .map((g) => ({
      ...g, kg: kg(g.kg), oldestDispatchedAt: g.oldestDispatchedAt.toISOString(),
      subcontractorCode: subBy.get(g.subcontractorId)?.code ?? null, subcontractorName: subBy.get(g.subcontractorId)?.name ?? null,
      yarnItemCode: yarnBy.get(g.yarnItemId)?.code ?? null, yarnItemName: yarnBy.get(g.yarnItemId)?.name ?? null,
      ownerCustomerName: g.ownerCustomerId ? ownerBy.get(g.ownerCustomerId) ?? null : null,
    }));
}
