// =============================================================================
// FASON DEVERE D5 — dönen leventin ipliğini sevk kalemlerine DAĞITIM (tek helper; kabul ve önizleme aynı fonksiyon)
// =============================================================================
// Sıra (belirlenimli, plan §4.6): ① BU siparişin tuttuğu kalemler (kendi sevki + aktarımla gelen) sevk sırasıyla →
// ② DEVİR: aynı devereci + aynı iplik + aynı sahip, KAPANMIŞ (COMPLETED) başka siparişlerin tuttuğu kalemler, sevk
// sırasıyla — tutan = o kapanmış sipariş → ③ hâlâ artan nominal kg DAĞITILMAZ (uyarı; bakiye eksiye inmez).
// Dağıtım BEYANLI varsayımdır (devereci hangi lotu hangi levente sardığını bildirmez): "nominal, sevk sırasına göre".
// =============================================================================
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import { singleOwner } from "./emanet-owner.helper";
import { loadWarpingYarnHoldings, loadWarpingYarnItems } from "./warping-yarn-open.helper";

type Db = Parameters<typeof loadWarpingYarnHoldings>[0];
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface AllocationCandidate {
  dispatchItemId: string;
  dispatchNo: string;
  dispatchedAt: Date;
  /** Tutması düşecek sipariş. */
  holderWarpingOrderId: string;
  holderOrderNo: string | null;
  yarnItemId: string;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  availableKg: Prisma.Decimal;
  carryOver: boolean;
}

export interface AllocationNeed<K> {
  key: K;
  yarnItemId: string;
  kg: Prisma.Decimal;
}

export interface AllocationRow<K> {
  key: K;
  candidate: AllocationCandidate;
  kg: Prisma.Decimal;
}

/** Saf açgözlü dağıtım: ihtiyaçlar verilen sırayla (levent → plan satırı), adaylar verilen sırayla tüketilir. */
export function allocateWoundYarn<K>(needs: Array<AllocationNeed<K>>, candidates: AllocationCandidate[]): { rows: Array<AllocationRow<K>>; unallocated: Map<string, Prisma.Decimal> } {
  const left = candidates.map((c) => ({ c, kg: c.availableKg }));
  const rows: Array<AllocationRow<K>> = [];
  const unallocated = new Map<string, Prisma.Decimal>();
  for (const n of needs) {
    let need = n.kg;
    for (const slot of left) {
      if (need.lte(0)) break;
      if (slot.c.yarnItemId !== n.yarnItemId || slot.kg.lte(0)) continue;
      const take = Prisma.Decimal.min(slot.kg, need);
      slot.kg = slot.kg.minus(take);
      need = need.minus(take);
      rows.push({ key: n.key, candidate: slot.c, kg: take });
    }
    if (need.gt(0)) unallocated.set(n.yarnItemId, (unallocated.get(n.yarnItemId) ?? D(0)).plus(need));
  }
  return { rows, unallocated };
}

const byDispatchOrder = (a: AllocationCandidate, b: AllocationCandidate) =>
  a.dispatchedAt.getTime() - b.dispatchedAt.getTime() || a.dispatchItemId.localeCompare(b.dispatchItemId) || a.holderWarpingOrderId.localeCompare(b.holderWarpingOrderId);

/**
 * Siparişin dağıtım adayları (sıralı) + doğacak leventin sahibi. Sahip = siparişin tuttuğu ipliğin tek sahibi (KATI;
 * tutma yoksa fabrika malı) — devir yalnız AYNI sahipten (fabrika malı ↔ emanet ve iki müşteri karışmaz).
 */
export async function loadAllocationCandidates(
  db: Db,
  order: { id: string; subcontractorId: string; yarnItemIds: string[] },
): Promise<{ candidates: AllocationCandidate[]; ownerCustomerId: string | null }> {
  const own = (await loadWarpingYarnItems(db, { warpingOrderId: order.id })).filter((i) => i.openKg.gt(0) && order.yarnItemIds.includes(i.yarnItemId));
  const ownerCustomerId = singleOwner(own.map((i) => i.ownerCustomerId), "Fason devere siparişi", { strict: true });
  const ownC: AllocationCandidate[] = own.map((i) => ({
    dispatchItemId: i.dispatchItemId, dispatchNo: i.dispatchNo, dispatchedAt: i.dispatchedAt, holderWarpingOrderId: order.id, holderOrderNo: null,
    yarnItemId: i.yarnItemId, lotId: i.lotId, lotNo: i.lotNo, ownerCustomerId: i.ownerCustomerId, availableKg: i.openKg, carryOver: false,
  }));
  const carry = (await loadWarpingYarnHoldings(db, { subcontractorIds: [order.subcontractorId], yarnItemIds: order.yarnItemIds, statuses: [WarpingOrderStatus.COMPLETED] }))
    .filter((h) => h.warpingOrderId !== order.id && h.ownerCustomerId === ownerCustomerId && h.kg.gt(0))
    .map((h): AllocationCandidate => ({
      dispatchItemId: h.dispatchItemId, dispatchNo: h.dispatchNo, dispatchedAt: h.dispatchedAt, holderWarpingOrderId: h.warpingOrderId, holderOrderNo: h.orderNo,
      yarnItemId: h.yarnItemId, lotId: h.lotId, lotNo: h.lotNo, ownerCustomerId: h.ownerCustomerId, availableKg: h.kg, carryOver: true,
    }));
  return { candidates: [...ownC.sort(byDispatchOrder), ...carry.sort(byDispatchOrder)], ownerCustomerId };
}
