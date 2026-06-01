// =============================================================================
// Sipariş kalemi kapsama (coverage) — GEVŞEK MODEL (spec-aggregate)
// =============================================================================
// Top→sipariş bağı (Roll.targetOrderLineId) KALDIRILDI. Karşılanma iki defterden
// türetilir:
//   1) Sevk (gerçek):  OrderLine.shippedQty  (= Σ ShipmentAllocation.qty)
//   2) Tahsis (plan):  WorkOrderToOrderLine.allocatedQty (canlı WO in-flight payı)
//
// MODEL (her sipariş satırı L için):
//   shipped(L)  = OrderLine.shippedQty — Sevke Hazır anında düşülen metraj
//   reserved(L) = Σ canlı WO için: o WO'nun bitmemiş (in-flight) üretiminin L'e
//                 düşen payı. inFlight(W) = max(0, totalAlloc(W) − finishedByW).
//                 Yani WO üretimini bitirdikçe plan-rezervi erir; üretilen mal
//                 depoya/serbest stoğa düşer ve spec-toplam olarak sayılır.
//   coverage(L) = shipped + reserved
//   open(L)     = quantity(L) − coverage(L)
//
// "Depodaki serbest stok" (WAREHOUSE/STOCK) bu kapsamaya GİRMEZ — fungible havuz
// olduğu için satıra atfedilemez (çift sayım). Onu spec bazında ayrı gösteren
// getCoverageForLines (order.service) yapar. Burada yalnız satıra ait kesin
// muhasebe (sevk + plan rezervi) hesaplanır.
// =============================================================================

import { Prisma, RollStatus, WorkOrderStatus } from "@prisma/client";

type Client = Prisma.TransactionClient | {
  orderLine: Prisma.TransactionClient["orderLine"];
  roll: Prisma.TransactionClient["roll"];
  workOrderToOrderLine: Prisma.TransactionClient["workOrderToOrderLine"];
  workOrderStep: Prisma.TransactionClient["workOrderStep"];
};

// "Plan rezervesi" hesabına dahil WO statüleri (CANCELLED hariç — iptal serbest bırakır).
const BLOCKING: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.PAUSED,
  WorkOrderStatus.COMPLETED,
];

// Terminal çıktı statüleri — "bu metraj artık üretildi/karara bağlandı".
const FINISHED_OUTPUT: RollStatus[] = [
  RollStatus.WAREHOUSE,
  RollStatus.A1_STOCK,
  RollStatus.SHIPPED,
  RollStatus.SCRAP,
];

export interface LineCoverage {
  shipped: Prisma.Decimal;
  reserved: Prisma.Decimal;
  /** shipped + reserved */
  coverage: Prisma.Decimal;
}

const D0 = () => new Prisma.Decimal(0);

/**
 * Verilen sipariş satırları için kapsama kovalarını (shipped + reserved) döner.
 * `excludeWorkOrderId` verilirse o WO'nun tahsisi reserved'a katılmaz
 * (WO düzenleme/oluşturma picker'ında kendi rezervini saymamak için).
 */
export async function computeLineCoverage(
  client: Client,
  lineIds: string[],
  opts?: { excludeWorkOrderId?: string }
): Promise<Map<string, LineCoverage>> {
  const result = new Map<string, LineCoverage>();
  const ids = [...new Set(lineIds)];
  if (ids.length === 0) return result;

  // 1) Sevk edilen — satır bazlı denormalize alan (ShipmentAllocation toplamı).
  const lineRows = await client.orderLine.findMany({
    where: { id: { in: ids } },
    select: { id: true, shippedQty: true },
  });
  const shippedByLine = new Map<string, Prisma.Decimal>();
  for (const l of lineRows) shippedByLine.set(l.id, new Prisma.Decimal(l.shippedQty));

  // 2) Bu satırlara bağlı tüm WO link'leri (allocatedQty + WO status).
  const links = await client.workOrderToOrderLine.findMany({
    where: { orderLineId: { in: ids } },
    select: { orderLineId: true, allocatedQty: true, workOrderId: true, workOrder: { select: { status: true } } },
  });

  // Canlı + (exclude değil) WO id'leri.
  const liveWoIds = [
    ...new Set(
      links
        .filter((l) => BLOCKING.includes(l.workOrder.status) && l.workOrderId !== opts?.excludeWorkOrderId)
        .map((l) => l.workOrderId)
    ),
  ];

  // 3) Bu WO'ların TÜM tahsisleri (totalAlloc(W) için — pay hesabı) + adımları.
  const finishedByWo = new Map<string, Prisma.Decimal>();
  const totalAllocByWo = new Map<string, Prisma.Decimal>();
  if (liveWoIds.length > 0) {
    const allLinks = await client.workOrderToOrderLine.findMany({
      where: { workOrderId: { in: liveWoIds } },
      select: { workOrderId: true, allocatedQty: true },
    });
    for (const l of allLinks) {
      totalAllocByWo.set(l.workOrderId, (totalAllocByWo.get(l.workOrderId) ?? D0()).plus(l.allocatedQty ?? 0));
    }

    const steps = await client.workOrderStep.findMany({
      where: { workOrderId: { in: liveWoIds } },
      select: { id: true, workOrderId: true },
    });
    const stepToWo = new Map<string, string>();
    for (const s of steps) stepToWo.set(s.id, s.workOrderId);
    const stepIds = steps.map((s) => s.id);

    if (stepIds.length > 0) {
      // finishedByW: producedInStepId ∈ W.steps ve status terminal çıktı.
      const finishedRows = await client.roll.groupBy({
        by: ["producedInStepId"],
        where: { producedInStepId: { in: stepIds }, status: { in: FINISHED_OUTPUT } },
        _sum: { currentQty: true },
      });
      for (const r of finishedRows) {
        if (!r.producedInStepId) continue;
        const woId = stepToWo.get(r.producedInStepId);
        if (!woId) continue;
        finishedByWo.set(woId, (finishedByWo.get(woId) ?? D0()).plus(r._sum.currentQty ?? 0));
      }
    }
  }

  // 4) Her satır için reserved = Σ canlı link: inFlight(W) × pay(L).
  for (const lineId of ids) {
    let reserved = D0();
    for (const link of links) {
      if (link.orderLineId !== lineId) continue;
      if (!BLOCKING.includes(link.workOrder.status)) continue;
      if (link.workOrderId === opts?.excludeWorkOrderId) continue;
      const totalAlloc = totalAllocByWo.get(link.workOrderId) ?? D0();
      if (totalAlloc.lessThanOrEqualTo(0)) continue; // 0-alloc link → rezerve katmaz
      const finished = finishedByWo.get(link.workOrderId) ?? D0();
      const inFlight = Prisma.Decimal.max(0, totalAlloc.minus(finished));
      const share = new Prisma.Decimal(link.allocatedQty ?? 0).div(totalAlloc);
      reserved = reserved.plus(inFlight.times(share));
    }
    const shipped = shippedByLine.get(lineId) ?? D0();
    result.set(lineId, {
      shipped,
      reserved,
      coverage: shipped.plus(reserved),
    });
  }

  return result;
}

export { BLOCKING as COVERAGE_BLOCKING_STATUSES };
