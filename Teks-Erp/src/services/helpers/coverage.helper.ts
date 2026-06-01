// =============================================================================
// Sipariş kalemi kapsama (coverage) — UZLAŞTIRILMIŞ tek-kaynak hesap
// =============================================================================
// İki paralel defter vardı ve uzlaşmıyordu:
//   1) Tahsis (plan):   WorkOrderToOrderLine.allocatedQty
//   2) Etiket (gerçek): Roll.targetOrderLineId + bitmiş status
// Bir iş emrinin çıktısı başka siparişe etiketlenince (tambur'da serbest atama),
// kaynak siparişin "reserved"ı erimiyordu → sipariş sessizce eksik kalıyordu
// (picker'da görünmez), hedef sipariş ise çift üretilebiliyordu.
//
// MODEL (her sipariş satırı L için):
//   shipped(L)          = L'e etiketli + SHIPPED topların metrajı
//   warehouseLabeled(L) = L'e etiketli + WAREHOUSE/A1_STOCK topların metrajı
//   reserved(L)         = Σ canlı WO için: o WO'nun bitmemiş (in-flight) üretiminin
//                         L'e düşen payı. inFlight(W) = max(0, totalAlloc(W) −
//                         finishedByW). Yani WO üretimini bitirdikçe plan-rezervi
//                         erir; mal nereye etiketlendiyse kapsama oraya geçer.
//   coverage(L)         = shipped + warehouseLabeled + reserved
//   open(L)             = quantity(L) − coverage(L)
//
// finishedByW = W'nin ürettiği (producedInStepId ∈ W.steps) ve terminal çıktıya
// ulaşmış (WAREHOUSE/A1_STOCK/SHIPPED/SCRAP) topların metrajı — etiketten bağımsız.
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
  warehouseLabeled: Prisma.Decimal;
  reserved: Prisma.Decimal;
  /** shipped + warehouseLabeled + reserved */
  coverage: Prisma.Decimal;
}

const D0 = () => new Prisma.Decimal(0);

/**
 * Verilen sipariş satırları için uzlaştırılmış kapsama kovalarını döner.
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

  // 1) Etiketli bitmiş toplar — (lineId, status) bazında tek groupBy.
  const labeled = await client.roll.groupBy({
    by: ["targetOrderLineId", "status"],
    where: {
      targetOrderLineId: { in: ids },
      status: { in: [RollStatus.SHIPPED, RollStatus.WAREHOUSE, RollStatus.A1_STOCK] },
    },
    _sum: { currentQty: true },
  });
  const shippedByLine = new Map<string, Prisma.Decimal>();
  const whLabeledByLine = new Map<string, Prisma.Decimal>();
  for (const g of labeled) {
    if (!g.targetOrderLineId) continue;
    const qty = g._sum.currentQty ?? D0();
    if (g.status === RollStatus.SHIPPED) {
      shippedByLine.set(g.targetOrderLineId, (shippedByLine.get(g.targetOrderLineId) ?? D0()).plus(qty));
    } else {
      whLabeledByLine.set(g.targetOrderLineId, (whLabeledByLine.get(g.targetOrderLineId) ?? D0()).plus(qty));
    }
  }

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
    const warehouseLabeled = whLabeledByLine.get(lineId) ?? D0();
    result.set(lineId, {
      shipped,
      warehouseLabeled,
      reserved,
      coverage: shipped.plus(warehouseLabeled).plus(reserved),
    });
  }

  return result;
}

export { BLOCKING as COVERAGE_BLOCKING_STATUSES };
