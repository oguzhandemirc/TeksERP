// =============================================================================
// Test: Yeniden-Etiketleme istasyonu bağlamı (getRelabelContext)
// Çalıştır: npx tsx scripts/test_roll_relabel_context.ts
// Doğrulananlar:
//   1. Bulunan top → spec (renk/kalite/en/özellik) + propertyIds doğru seed
//   2. lastLabelSnapshot ("A") aynen döner
//   3. Aday müşteriler ("B") = topu üreten WO'nun bağlı siparişinden distinct
//   4. Serbest WAREHOUSE top → specLocked=false
//   5. Committed (READY) sevkiyattaki top → specLocked=true + shipment.status
//   6. Ham top (colorId null, barkodlu) → color=null, çökmeden döner
//   7. Bulunamayan barkod → success=false
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ShippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function main() {
  const ts = Date.now();
  const inv = new InventoryService();
  const ship = new ShippingService();

  const customer = await prisma.customer.create({
    data: { code: `TST-RLBC-${ts}`, name: "TEST RELABEL CTX" },
    select: { id: true, code: true, name: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-RLBC-I-${ts}`, name: "TEST RLBC ÜRÜN", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `RLBC-${ts}`, name: "RLBC MAVİ", hex: "#1e40af" },
    select: { id: true },
  });
  const prop = await prisma.fabricProperty.findFirst({ where: { isActive: true }, select: { id: true } });
  const station = await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } });

  // Üretim zinciri: Order(+line) → WO → WO-step (producedInStep) → WO↔OrderLine link
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-RLBC-${ts}`,
      customerId: customer.id,
      status: "APPROVED",
      orderDate: new Date(),
      lines: { create: [{ itemId: item.id, quantity: 100, width: 150 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  const orderLineId = order.lines[0].id;

  const wo = await prisma.workOrder.create({
    data: { batchNumber: `TEST-RLBC-WO-${ts}` },
    select: { id: true },
  });
  const step = station
    ? await prisma.workOrderStep.create({
        data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
        select: { id: true },
      })
    : null;
  await prisma.workOrderToOrderLine.create({ data: { workOrderId: wo.id, orderLineId } });

  // r1: tam-spec WAREHOUSE top, üretim zincirine bağlı + lastLabelSnapshot
  const r1 = await prisma.roll.create({
    data: {
      barcode: `TEST-RLBC-R1-${ts}`,
      itemId: item.id,
      colorId: color.id,
      status: "WAREHOUSE",
      currentQty: 100,
      initialQty: 100,
      width: 150,
      qualityGrade: "1.KALITE",
      entrySource: "SUPPLIER_RECEIPT",
      producedInStepId: step?.id ?? null,
      lastLabelSnapshot: { customerId: customer.id, customerName: customer.name, orderNumber: order ? `TEST-RLBC-${ts}` : null },
      ...(prop ? { properties: { create: [{ propertyId: prop.id }] } } : {}),
    },
    select: { id: true, barcode: true },
  });

  // r2: ham (renksiz) barkodlu top — color null toleransı
  const r2 = await prisma.roll.create({
    data: {
      barcode: `TEST-RLBC-R2-${ts}`,
      itemId: item.id,
      colorId: null,
      status: "STOCK",
      currentQty: 50,
      initialQty: 50,
      qualityGrade: "1.KALITE",
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });

  // r3: committed (READY) sevkiyattaki top — specLocked=true
  const r3 = await prisma.roll.create({
    data: {
      barcode: `TEST-RLBC-R3-${ts}`,
      itemId: item.id,
      colorId: color.id,
      status: "WAREHOUSE",
      currentQty: 100,
      initialQty: 100,
      qualityGrade: "1.KALITE",
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });

  const shipmentIds: string[] = [];
  try {
    // 1) Bulunan top → spec doğru
    const ctx1 = await inv.getRelabelContext(r1.barcode!);
    check("Bulundu (success)", ctx1.success === true);
    const d1 = ctx1.data!;
    check("Doğru top (id)", d1?.id === r1.id);
    check("Renk seed (colorId)", d1?.colorId === color.id);
    check("Renk objesi + hex", d1?.color?.hex === "#1e40af");
    check("Kalite snapshot", d1?.qualityGrade === "1.KALITE");
    check("En sayısal (150)", d1?.width === 150);
    check("currentQty sayısal (100)", d1?.currentQty === 100);
    if (prop) {
      check("propertyIds seed", d1?.propertyIds.length === 1 && d1.propertyIds[0] === prop.id);
      check("properties objesi", d1?.properties.length === 1 && d1.properties[0].id === prop.id);
    }

    // 2) lastLabelSnapshot ("A") döner
    const snap = d1?.lastLabelSnapshot as { customerId?: string } | null;
    check("lastLabelSnapshot döner (A)", snap?.customerId === customer.id);

    // 3) Aday müşteriler ("B") — üretim zincirinden
    if (step) {
      const cand = d1?.candidateCustomers.find((c) => c.customerId === customer.id);
      check("Aday müşteri var (zincirden)", !!cand);
      check("Aday: orderLineId + orderNumber", cand?.orderLineId === orderLineId && cand?.orderNumber === `TEST-RLBC-${ts}`);
      check("Aday: müşteri kod/ad", cand?.customerCode === customer.code && cand?.customerName === customer.name);
    }

    // 4) Serbest WAREHOUSE → specLocked=false
    check("Serbest top specLocked=false", d1?.specLocked === false && d1?.shipment === null);

    // 6) Ham top (color null) toleransı
    const ctx2 = await inv.getRelabelContext(r2.barcode!);
    check("Ham top bulundu", ctx2.success === true);
    check("Ham top color=null (çökmedi)", ctx2.data?.colorId === null && ctx2.data?.color === null);
    check("Ham top aday müşteri yok", ctx2.data?.candidateCustomers.length === 0);

    // 5) Committed (READY) sevkiyat → specLocked=true
    const sh = (await ship.createShipment({ orderIds: [order.id] })).data as { id: string };
    shipmentIds.push(sh.id);
    const sack = (await ship.addSack({ shipmentId: sh.id })).data as { id: string };
    await ship.scanIntoShipment({ shipmentId: sh.id, barcode: r3.barcode!, sackId: sack.id });
    await ship.updateSack({ sackId: sack.id, weightKg: 30, manualCode: `RLBC${ts}` });
    await ship.markReady(sh.id);
    const ctx3 = await inv.getRelabelContext(r3.barcode!);
    check("Committed top specLocked=true", ctx3.data?.specLocked === true);
    check("Committed top shipment.status=READY", ctx3.data?.shipment?.status === "READY");

    // 7) Bulunamayan barkod
    const ctxMiss = await inv.getRelabelContext(`TEST-RLBC-YOK-${ts}`);
    check("Bulunamayan → success=false", ctxMiss.success === false && ctxMiss.data === null);
  } finally {
    for (const id of shipmentIds) {
      await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: id } });
      await prisma.roll.updateMany({ where: { shipmentId: id }, data: { shipmentId: null, sackId: null } });
      await prisma.sack.deleteMany({ where: { shipmentId: id } });
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: id } });
      await prisma.shipment.delete({ where: { id } }).catch(() => {});
    }
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: [r1.id, r2.id, r3.id] } } });
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id] } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: wo.id } });
    if (step) await prisma.workOrderStep.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.workOrder.delete({ where: { id: wo.id } }).catch(() => {});
    await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
    await prisma.color.delete({ where: { id: color.id } }).catch(() => {});
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
