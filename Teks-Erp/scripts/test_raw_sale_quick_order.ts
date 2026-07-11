// =============================================================================
// Test: Saha #10 (ham kumaş satışı) + #11 (hızlı sipariş)
// Çalıştır: npx tsx scripts/test_raw_sale_quick_order.ts
// Doğrulananlar:
//   1. prepareRawForSale: serbest STOCK ham top → WAREHOUSE
//   2. WO adımındaki / sevkiyattaki top prepareRawForSale REDDEDİLİR
//   3. quickOrderFromRolls: ham topları spec bazında gruplar → sipariş satırları
//   4. Aynı spec (ürün+renk+en) toplar tek satırda toplanır
//   5. quickOrder STOK topları WAREHOUSE'a alır (sevke hazır)
//   6. Ham (renksiz) sipariş satırı + ham top havuz akışında eşleşir
//      (çuval aç→okut→mühürle = packedQty rezerve; sevkiyat→dispatch = shippedQty karşılar)
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { OrderService } from "../src/services/order.service";
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
async function expectErr(label: string, code: number, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "hata bekleniyordu");
  } catch (e) {
    check(label, (e as { statusCode?: number }).statusCode === code);
  }
}

async function main() {
  const ts = Date.now();
  const inv = new InventoryService();
  const ship = new ShippingService();
  const orderSvc = new OrderService({
    modelName: "order",
    tableName: "ORDER",
    searchFields: ["orderNumber"],
    defaultInclude: { lines: true },
    nestedCreateFields: ["lines"],
  });

  const customer = await prisma.customer.create({
    data: { code: `TST-RAW-${ts}`, name: "TEST HAM SATIŞ" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-RAW-I-${ts}`, name: "HAM KUMAŞ", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });

  const mkRoll = (n: number, qty: number, w: number | null, status: "STOCK" | "WAREHOUSE" = "STOCK") =>
    prisma.roll.create({
      data: {
        barcode: `TEST-RAW-R${n}-${ts}`,
        itemId: item.id,
        colorId: null, // ham/renksiz
        status,
        currentQty: qty,
        initialQty: qty,
        width: w,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true, barcode: true },
    });

  const r1 = await mkRoll(1, 100, 150);
  const r2 = await mkRoll(2, 50, 150); // r1 ile aynı spec
  const r3 = await mkRoll(3, 80, 200); // farklı en
  const createdOrders: string[] = [];
  const createdShipments: string[] = [];
  const createdSacks: string[] = [];

  try {
    // 1) prepareRawForSale
    await inv.prepareRawForSale(r1.id);
    const r1After = await prisma.roll.findUnique({ where: { id: r1.id }, select: { status: true } });
    check("prepareRawForSale: STOCK → WAREHOUSE", r1After?.status === "WAREHOUSE");

    // 2) STOCK olmayan (üretimdeki) top reddedilir — IN_PRODUCTION → 400
    const inProd = await mkRoll(9, 60, 150);
    await prisma.roll.update({ where: { id: inProd.id }, data: { status: "IN_PRODUCTION" } });
    await expectErr("IN_PRODUCTION top prepareRawForSale 400 (yalnız STOCK)", 400, () =>
      inv.prepareRawForSale(inProd.id),
    );
    await prisma.roll.delete({ where: { id: inProd.id } }).catch(() => {});

    // 3+4) quickOrderFromRolls: r1+r2 (aynı spec) + r3 (farklı) → 2 satır
    const qo = await orderSvc.quickOrderFromRolls(
      { customerId: customer.id, rollIds: [r1.id, r2.id, r3.id] },
      undefined,
    );
    const qd = qo.data as { order: { id: string; orderNumber: string }; lineCount: number; rollCount: number };
    createdOrders.push(qd.order.id);
    check("quickOrder: 3 top → 2 satır (spec grupla)", qd.lineCount === 2 && qd.rollCount === 3, `${qd.lineCount} satır`);

    const lines = await prisma.orderLine.findMany({
      where: { orderId: qd.order.id },
      select: { quantity: true, width: true, colorId: true },
      orderBy: { quantity: "desc" },
    });
    check("quickOrder: aynı spec toplandı (150m+50? hayır 150cm grubu=150m)", Number(lines[0].quantity) === 150, `${lines[0]?.quantity}`);
    check("quickOrder: satırlar renksiz (ham)", lines.every((l) => l.colorId === null));

    // 5) STOK topları WAREHOUSE'a alındı (r2,r3 STOCK'tu; r1 zaten WAREHOUSE)
    const states = await prisma.roll.findMany({
      where: { id: { in: [r2.id, r3.id] } },
      select: { status: true },
    });
    check("quickOrder: STOK toplar WAREHOUSE'a alındı", states.every((s) => s.status === "WAREHOUSE"));

    // 6) Ham sipariş + ham top havuz akışında eşleşir. Çuval MÜŞTERİYE ait:
    //    aç → r3'ü okut → tart+kod → mühürle. Mühür → rebalance FIFO renk-null spec ile
    //    200cm satıra rezerve eder (packedQty). Sevkiyat → dispatch → shippedQty terfi.
    const sackId = ((await ship.openSack({ customerId: customer.id })).data as { id: string }).id;
    createdSacks.push(sackId);
    await ship.scanIntoSack({ sackId, barcode: r3.barcode });
    await ship.weighSack({ sackId, weightKg: 20, manualCode: `RAW${ts}` });
    await ship.sealSack({ sackId });

    // 200cm satır (80m talep) ham top r3 (80m) ile rezerve edildi (renk-null kapsama eşleşti).
    const line200Sealed = await prisma.orderLine.findFirst({
      where: { orderId: qd.order.id, width: 200 },
      select: { packedQty: true },
    });
    check("Ham 200cm satır rezerve (mühür → packedQty=80, renk-null eşleşti)", Number(line200Sealed?.packedQty) === 80, `${line200Sealed?.packedQty}`);

    // Havuzdan çuval seç → sevkiyat (PLANNED) → dispatch → karşılanma kesinleşir.
    const sh2 = (await ship.createShipment({ sackIds: [sackId] })).data as { id: string };
    createdShipments.push(sh2.id);
    await ship.dispatchShipment(sh2.id, {});
    const line200 = await prisma.orderLine.findFirst({
      where: { orderId: qd.order.id, width: 200 },
      select: { shippedQty: true, packedQty: true },
    });
    check("Ham 200cm satır karşılandı (dispatch → shippedQty=80)", Number(line200?.shippedQty) === 80, `${line200?.shippedQty}`);
    check("Ham 200cm satır rezervi sevke döndü (packedQty=0)", Number(line200?.packedQty) === 0, `${line200?.packedQty}`);
  } finally {
    // Çuval havuzu ters bağımlılık: SackAllocation (Restrict) → roll↔çuval/sevkiyat bağını
    // çöz → sack → ShipmentOrder (Restrict) → shipment → roll → sipariş → master-data.
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: createdSacks } } });
    await prisma.roll.updateMany({ where: { id: { in: [r1.id, r2.id, r3.id] } }, data: { shipmentId: null, sackId: null } });
    await prisma.sack.deleteMany({ where: { id: { in: createdSacks } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipments } } });
    await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } });
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id] } } });
    for (const id of createdOrders) {
      await prisma.orderLine.deleteMany({ where: { orderId: id } });
      await prisma.order.delete({ where: { id } }).catch(() => {});
    }
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
