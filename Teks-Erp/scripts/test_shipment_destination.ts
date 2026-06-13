// =============================================================================
// Test: Saha #19+#22 — yurtiçi/yurtdışı sevkiyat
// Çalıştır: npx tsx scripts/test_shipment_destination.ts
// Doğrulananlar:
//   1. createShipment default DOMESTIC
//   2. createShipment destination=EXPORT açıkça
//   3. setDestination DOMESTIC↔EXPORT geçişi (sevk edilmemişte serbest)
//   4. DOMESTIC: tartısız çuvalla markReady ÇALIŞIR (tartı zorunlu değil)
//   5. EXPORT: tartısız çuvalla markReady BLOKLAR; tartınca geçer
//   6. Kod zorunluluğu iki kapsamda da sürer
//   7. board destination filtresi + rozet alanı
// =============================================================================
import prisma from "../src/lib/prisma";
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
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "hata bekleniyordu");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(label, m.includes(part), m);
  }
}

async function main() {
  const ts = Date.now();
  const svc = new ShippingService();

  const customer = await prisma.customer.create({
    data: { code: `TST-DST-${ts}`, name: "TEST DESTINATION" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-DST-I-${ts}`, name: "TEST DST ÜRÜN", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const mkOrder = async (n: number) => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `TEST-DST-${ts}-${n}`,
        customerId: customer.id,
        status: "APPROVED",
        orderDate: new Date(),
        lines: { create: [{ itemId: item.id, quantity: 100, width: 150 }] },
      },
      select: { id: true },
    });
    return o.id;
  };
  const order1 = await mkOrder(1);
  const order2 = await mkOrder(2);

  const createdShipments: string[] = [];
  const createdRolls: string[] = [];

  const addRollToSack = async (shipmentId: string, sackId: string, n: number, qty: number) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-DST-R${n}-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        currentQty: qty,
        initialQty: qty,
        width: 150,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId,
        sackId,
      },
      select: { id: true },
    });
    createdRolls.push(r.id);
  };

  try {
    // 1) Default DOMESTIC
    const s1 = (await svc.createShipment({ orderIds: [order1] })).data as {
      id: string;
      destination: string;
    };
    createdShipments.push(s1.id);
    check("createShipment default DOMESTIC", s1.destination === "DOMESTIC", s1.destination);

    // 2) Açıkça EXPORT
    const s2 = (await svc.createShipment({ orderIds: [order2], destination: "EXPORT" })).data as {
      id: string;
      destination: string;
    };
    createdShipments.push(s2.id);
    check("createShipment EXPORT", s2.destination === "EXPORT", s2.destination);

    // 3) setDestination geçişi
    await svc.setDestination(s1.id, "EXPORT");
    let after = await prisma.shipment.findUnique({ where: { id: s1.id }, select: { destination: true } });
    check("setDestination DOMESTIC→EXPORT", after?.destination === "EXPORT");
    await svc.setDestination(s1.id, "DOMESTIC");
    after = await prisma.shipment.findUnique({ where: { id: s1.id }, select: { destination: true } });
    check("setDestination EXPORT→DOMESTIC", after?.destination === "DOMESTIC");

    // 4) DOMESTIC: tartısız çuval + kodlu → markReady çalışır
    const sackD = (await svc.addSack({ shipmentId: s1.id })).data as { id: string };
    await addRollToSack(s1.id, sackD.id, 1, 100);
    // kod ver ama tartı VERME
    await svc.updateSack({ sackId: sackD.id, manualCode: `DSTK${ts}1` });
    const readyDom = await svc.markReady(s1.id);
    check("DOMESTIC tartısız markReady çalışır", (readyDom as { success: boolean }).success === true);

    // 5) EXPORT: tartısız çuval bloklar
    const sackE = (await svc.addSack({ shipmentId: s2.id })).data as { id: string };
    await addRollToSack(s2.id, sackE.id, 2, 100);
    await svc.updateSack({ sackId: sackE.id, manualCode: `DSTK${ts}2` });
    await expectErr("EXPORT tartısız markReady BLOKLAR", "tartısı girilmemiş (yurtdışı", () =>
      svc.markReady(s2.id)
    );
    // tartınca geçer
    await svc.updateSack({ sackId: sackE.id, weightKg: 30 });
    const readyExp = await svc.markReady(s2.id);
    check("EXPORT tartınca markReady geçer", (readyExp as { success: boolean }).success === true);

    // 6) Kod zorunluluğu DOMESTIC'te de sürer → yeni domestic, kodsuz
    const order3 = await mkOrder(3);
    const s3 = (await svc.createShipment({ orderIds: [order3] })).data as { id: string };
    createdShipments.push(s3.id);
    const sackNoCode = (await svc.addSack({ shipmentId: s3.id })).data as { id: string };
    await addRollToSack(s3.id, sackNoCode.id, 3, 50);
    await svc.updateSack({ sackId: sackNoCode.id, weightKg: 10 }); // tartı var
    // addSack otomatik AMB kodu veriyor (saha #5) → uncoded yolunu test için kodu temizle
    await prisma.sack.update({ where: { id: sackNoCode.id }, data: { manualCode: null } });
    await expectErr("DOMESTIC'te de kod zorunlu", "kodu girilmemiş", () => svc.markReady(s3.id));

    // 7) board filtre + rozet
    const boardExport = await svc.listSackStoreBoard({ destination: "EXPORT" });
    const exportRows = boardExport.data as Array<{ id: string; destination: string }>;
    check(
      "board EXPORT filtresi yalnız ihracat döndürür",
      exportRows.every((r) => r.destination === "EXPORT") && exportRows.some((r) => r.id === s2.id),
    );
    const boardDom = await svc.listSackStoreBoard({ destination: "DOMESTIC" });
    const domRows = boardDom.data as Array<{ id: string; destination: string }>;
    check(
      "board DOMESTIC filtresi s1'i döndürür (s2 yok)",
      domRows.some((r) => r.id === s1.id) && !domRows.some((r) => r.id === s2.id),
    );
  } finally {
    await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: { in: createdShipments } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
    await prisma.sack.deleteMany({ where: { shipmentId: { in: createdShipments } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipments } } });
    await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } });
    await prisma.orderLine.deleteMany({ where: { order: { customerId: customer.id } } });
    await prisma.order.deleteMany({ where: { customerId: customer.id } });
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
