// Sipariş → sevkiyat drill-down (getOrderShipments) testi.
// Çalıştırma:  npx tsx scripts/test_order_shipments.ts
//
// Sözleşme: çuval sevki (DISPATCHED + PLANNED, CANCELLED hariç) + fason direkt sevk
// birleşir; dispatchedTotal = order.shippedQty ile MUTABIK (computeLineLedger de
// DISPATCHED çuval + direkt toplar). Bilgilendirici snapshot.
//
// Veri: müşteri + item + order(2 kalem) + 3 çuval-sevki (DISPATCHED/PLANNED/CANCELLED)
// + fason zinciri (istasyon/WO/adım/parti/fason/dispatch/DirectShipment/allocation).
// TEST- business-key; finally'de temizlenir.
//
// Doğrulananlar:
//   1. Liste doğru sevkiyatları + per-sevkiyat qty döner (SD=60, SP=40, DS=30)
//   2. CANCELLED sevk (SC) listede YOK
//   3. dispatchedTotal = DISPATCHED çuval (60) + direkt (30) = 90
//   4. plannedTotal = PLANNED çuval (40)
//   5. recomputeOrderStatus sonrası dispatchedTotal === Σ line.shippedQty (mutabakat)
//   6. Dönüş tipleri number

import { ShipmentStatus, StationType, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { recomputeOrderStatus } from "../src/services/helpers/order-status.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const svc = new OrderService({
    modelName: "order",
    tableName: "ORDER",
    searchFields: ["orderNumber"],
    dateFields: ["createdAt", "deadline"],
    nestedCreateFields: ["lines"],
  });

  const ts = Date.now();
  const created: { table: string; id: string }[] = [];
  const track = <T extends { id: string }>(table: string, row: T): T => {
    created.push({ table, id: row.id });
    return row;
  };

  // Master + sipariş
  const customer = track("customer", await prisma.customer.create({
    data: { code: `TST-OSH-CUS-${ts}`, name: "Test OSH Müşteri" }, select: { id: true },
  }));
  const item = track("item", await prisma.item.create({
    data: { code: `TST-OSH-ITM-${ts}`, name: "Test OSH Ürün", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  }));
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-OSH-${ts}`,
      customerId: customer.id,
      lines: { create: [
        { itemId: item.id, quantity: 200 },
        { itemId: item.id, quantity: 100 },
      ] },
    },
    select: { id: true, lines: { select: { id: true }, orderBy: { createdAt: "asc" } } },
  });
  created.push({ table: "order", id: order.id });
  const [l1, l2] = order.lines;

  // Çuval sevkiyatları
  const mkShipment = async (suffix: string, status: ShipmentStatus, dispatched: boolean) =>
    track("shipment", await prisma.shipment.create({
      data: {
        shipmentNo: `TST-OSH-${suffix}-${ts}`,
        customerId: customer.id,
        status,
        ...(dispatched ? { dispatchedAt: new Date() } : {}),
      },
      select: { id: true },
    }));
  const mkSack = async (suffix: string, shipmentId: string) =>
    track("sack", await prisma.sack.create({
      data: { sackNo: `TST-OSH-SACK-${suffix}-${ts}`, shipmentId }, select: { id: true },
    }));
  const mkAlloc = (sackId: string, orderLineId: string, qty: number) =>
    prisma.sackAllocation.create({ data: { sackId, orderLineId, qty }, select: { id: true } });

  const sd = await mkShipment("SD", ShipmentStatus.DISPATCHED, true);
  const sp = await mkShipment("SP", ShipmentStatus.PLANNED, false);
  const sc = await mkShipment("SC", ShipmentStatus.CANCELLED, false);
  const skD = await mkSack("D", sd.id);
  const skP = await mkSack("P", sp.id);
  const skC = await mkSack("C", sc.id);
  await mkAlloc(skD.id, l1.id, 60);  // DISPATCHED
  await mkAlloc(skP.id, l1.id, 40);  // PLANNED
  await mkAlloc(skC.id, l2.id, 999); // CANCELLED → hariç

  // Fason direkt sevk zinciri
  const station = track("station", await prisma.station.create({
    data: { code: `TST-OSH-STN-${ts}`, name: "OSH İstasyon", type: StationType.EXTERNAL },
    select: { id: true },
  }));
  const wo = track("workOrder", await prisma.workOrder.create({
    data: { workOrderNumber: `TEST-OSH-WO-${ts}`, status: WorkOrderStatus.IN_PROGRESS },
    select: { id: true },
  }));
  const step = track("workOrderStep", await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 }, select: { id: true },
  }));
  const batch = track("batch", await prisma.batch.create({
    data: { batchNumber: `TST-OSH-BATCH-${ts}`, workOrderId: wo.id }, select: { id: true },
  }));
  const sub = track("subcontractor", await prisma.subcontractor.create({
    data: { code: `TST-OSH-SUB-${ts}`, name: "OSH Fason" }, select: { id: true },
  }));
  const dispatch = track("subcontractorDispatch", await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: `TST-OSH-SD-${ts}`,
      workOrderId: wo.id, batchId: batch.id, stepId: step.id, subcontractorId: sub.id,
    },
    select: { id: true },
  }));
  const directShip = track("directShipment", await prisma.directShipment.create({
    data: {
      shipmentNo: `TST-OSH-DSK-${ts}`,
      dispatchId: dispatch.id, customerId: customer.id, reason: "test",
      totalQty: 30, rollCount: 1,
    },
    select: { id: true },
  }));
  await prisma.subcontractorDirectShipAllocation.create({
    data: { dispatchId: dispatch.id, orderLineId: l2.id, qty: 30, directShipmentId: directShip.id },
    select: { id: true },
  });

  try {
    const res = (await svc.getOrderShipments(order.id)).data;
    const byNo = new Map(res.shipments.map((s) => [s.shipmentNo, s]));

    const rowSD = byNo.get(`TST-OSH-SD-${ts}`);
    const rowSP = byNo.get(`TST-OSH-SP-${ts}`);
    const rowDS = byNo.get(`TST-OSH-DSK-${ts}`);
    check("1a. DISPATCHED çuval satırı qty=60, sackCount=1",
      rowSD?.qty === 60 && rowSD?.sackCount === 1 && rowSD?.status === "DISPATCHED" && rowSD?.kind === "SHIPMENT",
      JSON.stringify(rowSD));
    check("1b. PLANNED çuval satırı qty=40",
      rowSP?.qty === 40 && rowSP?.status === "PLANNED", JSON.stringify(rowSP));
    check("1c. Fason direkt satırı qty=30, kind=DIRECT",
      rowDS?.qty === 30 && rowDS?.kind === "DIRECT", JSON.stringify(rowDS));

    check("2. CANCELLED sevk listede YOK",
      !res.shipments.some((s) => s.shipmentNo === `TST-OSH-SC-${ts}`) && res.shipments.length === 3,
      `count=${res.shipments.length}`);

    check("3. dispatchedTotal = 60 (çuval) + 30 (direkt) = 90",
      res.dispatchedTotal === 90, `dispatchedTotal=${res.dispatchedTotal}`);
    check("4. plannedTotal = 40 (PLANNED çuval)",
      res.plannedTotal === 40, `plannedTotal=${res.plannedTotal}`);

    // 5. Mutabakat: recompute sonrası dispatchedTotal === Σ line.shippedQty
    await prisma.$transaction((tx) => recomputeOrderStatus(tx, order.id));
    const lines = await prisma.orderLine.findMany({
      where: { orderId: order.id }, select: { shippedQty: true },
    });
    const shippedSum = lines.reduce((s, l) => s + Number(l.shippedQty), 0);
    check("5. dispatchedTotal === Σ line.shippedQty (mutabakat)",
      res.dispatchedTotal === shippedSum, `drill=${res.dispatchedTotal} shipped=${shippedSum}`);

    check("6. Dönüş tipleri number",
      typeof res.dispatchedTotal === "number" && typeof res.plannedTotal === "number" &&
      res.shipments.every((s) => typeof s.qty === "number"));
  } finally {
    // Ters bağımlılık sırası ile temizle.
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { orderLine: { orderId: order.id } } });
    await prisma.directShipment.deleteMany({ where: { id: directShip.id } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: dispatch.id } });
    await prisma.batch.deleteMany({ where: { id: batch.id } });
    await prisma.workOrderStep.deleteMany({ where: { id: step.id } });
    await prisma.workOrder.deleteMany({ where: { id: wo.id } });
    await prisma.sackAllocation.deleteMany({ where: { orderLine: { orderId: order.id } } });
    await prisma.sack.deleteMany({ where: { id: { in: [skD.id, skP.id, skC.id] } } });
    await prisma.shipment.deleteMany({ where: { id: { in: [sd.id, sp.id, sc.id] } } });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.subcontractor.deleteMany({ where: { id: sub.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
