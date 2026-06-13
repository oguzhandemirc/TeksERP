// =============================================================================
// Test: Saha #7 — sevkiyat yeniden hedefleme (bağlı sipariş kümesini değiştir)
// Çalıştır: npx tsx scripts/test_shipment_retarget.ts
// Doğrulananlar:
//   1. PREPARING'de retarget sipariş kümesini replace eder
//   2. READY'de retarget: eski siparişin shippedQty'si düşer, yeniye yazılır (reverse+recommit)
//   3. Farklı müşteri siparişi reddedilir (400)
//   4. DISPATCHED retarget reddedilir (409)
// =============================================================================
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, code: number, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { check(label, (e as { statusCode?: number }).statusCode === code); }
}

async function main() {
  const ts = Date.now();
  const ship = new ShippingService();

  const customer = await prisma.customer.create({ data: { code: `TST-RTG-${ts}`, name: "TEST RETARGET" }, select: { id: true } });
  const other = await prisma.customer.create({ data: { code: `TST-RTG-O-${ts}`, name: "TEST RETARGET DİĞER" }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `TST-RTG-I-${ts}`, name: "RTG ÜRÜN", itemType: "FABRIC", unit: "MT" }, select: { id: true } });

  const mkOrder = async (cust: string, n: number) => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `TEST-RTG-${ts}-${n}`,
        customerId: cust,
        status: "APPROVED",
        orderDate: new Date(),
        lines: { create: [{ itemId: item.id, quantity: 100, width: 150 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    return { id: o.id, lineId: o.lines[0].id };
  };
  const orderA = await mkOrder(customer.id, 1);
  const orderB = await mkOrder(customer.id, 2);
  const orderOther = await mkOrder(other.id, 3);

  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TEST-RTG-${ts}`, customerId: customer.id, status: "PREPARING", orders: { create: [{ orderId: orderA.id }] } },
    select: { id: true },
  });
  const r1 = await prisma.roll.create({
    data: {
      barcode: `TEST-RTG-R1-${ts}`, itemId: item.id, status: "WAREHOUSE", currentQty: 100, initialQty: 100,
      width: 150, qualityGrade: "A", entrySource: "SUPPLIER_RECEIPT", shipmentId: shipment.id,
    },
    select: { id: true, barcode: true },
  });
  const sack = (await ship.addSack({ shipmentId: shipment.id })).data as { id: string };
  await prisma.roll.update({ where: { id: r1.id }, data: { sackId: sack.id } });

  const shippedQty = async (lineId: string) =>
    Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);

  try {
    // 3) farklı müşteri reddedilir
    await expectErr("Farklı müşteri siparişi 400", 400, () => ship.retargetOrders(shipment.id, [orderOther.id]));

    // 1) PREPARING replace (A → B)
    await ship.retargetOrders(shipment.id, [orderB.id]);
    const so = await prisma.shipmentOrder.findMany({ where: { shipmentId: shipment.id }, select: { orderId: true } });
    check("PREPARING retarget: sipariş kümesi B oldu", so.length === 1 && so[0].orderId === orderB.id);

    // 2) READY commit sonrası retarget B → A: B düşer, A yazılır
    await ship.updateSack({ sackId: sack.id, weightKg: 30, manualCode: `RTG${ts}` });
    await ship.markReady(shipment.id);
    check("READY commit: B shippedQty=100", (await shippedQty(orderB.lineId)) === 100);
    await ship.retargetOrders(shipment.id, [orderA.id]);
    check("READY retarget: B geri sarıldı (0)", (await shippedQty(orderB.lineId)) === 0);
    check("READY retarget: A yazıldı (100)", (await shippedQty(orderA.lineId)) === 100, String(await shippedQty(orderA.lineId)));

    // 4) DISPATCHED reddedilir
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "DISPATCHED" } });
    await expectErr("DISPATCHED retarget 409", 409, () => ship.retargetOrders(shipment.id, [orderB.id]));
  } finally {
    await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.roll.deleteMany({ where: { id: r1.id } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    for (const o of [orderA, orderB, orderOther]) {
      await prisma.orderLine.deleteMany({ where: { orderId: o.id } });
      await prisma.order.delete({ where: { id: o.id } }).catch(() => {});
    }
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: [customer.id, other.id] } } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
