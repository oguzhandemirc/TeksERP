// =============================================================================
// Test: Saha #4 — top etiketi değiştirme (renk/özellik/en/kalite)
// Çalıştır: npx tsx scripts/test_roll_relabel.ts
// Doğrulananlar:
//   1. Serbest WAREHOUSE topun rengi/eni/kalitesi değişir
//   2. Özellik (RollProperty) replace
//   3. PREPARING sevkiyattaki top relabel edilebilir
//   4. READY (commit'li) sevkiyattaki top relabel REDDEDİLİR (409)
//   5. Renksiz (color null) yapılabilir
//   6. Metraj (currentQty) düzeltmesi — bütün topta initialQty ile birlikte güncellenir
//   7. Kısmen tüketilmiş topta metraj düzeltme reddedilir (renk-only geçer)
//   8-10. Etiket bayat: relabel→labelDirty=true, baskı→false, no-op→temiz kalır
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ShippingService } from "../src/services/shipping.service";
import { LabelService } from "../src/services/label.service";

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
    data: { code: `TST-RLB-${ts}`, name: "TEST RELABEL" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-RLB-I-${ts}`, name: "TEST RLB ÜRÜN", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const colorA = await prisma.color.create({ data: { code: `RLB-A-${ts}`, name: "RLB MAVİ" }, select: { id: true } });
  const colorB = await prisma.color.create({ data: { code: `RLB-B-${ts}`, name: "RLB YEŞİL" }, select: { id: true } });
  const prop = await prisma.fabricProperty.findFirst({ where: { isActive: true }, select: { id: true } });

  const mkRoll = (n: number) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-RLB-R${n}-${ts}`,
        itemId: item.id,
        colorId: colorA.id,
        status: "WAREHOUSE",
        currentQty: 100,
        initialQty: 100,
        width: 150,
        qualityGrade: "B",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true, barcode: true },
    });

  const r1 = await mkRoll(1);
  const r2 = await mkRoll(2);
  const r3 = await mkRoll(3);
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];

  try {
    // 1+2) Serbest topu relabel
    await inv.applyManualProperties(
      r1.id,
      { colorId: colorB.id, propertyIds: prop ? [prop.id] : [], width: 200, qualityGrade: "A1" },
      undefined,
    );
    const r1After = await prisma.roll.findUnique({
      where: { id: r1.id },
      select: { colorId: true, width: true, qualityGrade: true, properties: { select: { propertyId: true } } },
    });
    check("Renk değişti (A→B)", r1After?.colorId === colorB.id);
    check("En değişti (150→200)", Number(r1After?.width) === 200);
    check("Kalite değişti (B→A1, katalog doğrulandı + FK senkron)", r1After?.qualityGrade === "A1");
    if (prop) check("Özellik atandı (replace)", r1After?.properties.length === 1 && r1After.properties[0].propertyId === prop.id);

    // 5) Renksiz yap
    await inv.applyManualProperties(r1.id, { colorId: null, propertyIds: [] }, undefined);
    const r1Raw = await prisma.roll.findUnique({ where: { id: r1.id }, select: { colorId: true, properties: true } });
    check("Renksiz (color null) + özellik temizlendi", r1Raw?.colorId === null && r1Raw.properties.length === 0);

    // 3) PREPARING sevkiyattaki top relabel edilebilir
    const sh1 = (await ship.createShipment({ orderIds: [] }).catch(() => null)) as { data: { id: string } } | null;
    // createShipment boş orderIds reddeder → sipariş üret
    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-RLB-${ts}`,
        customerId: customer.id,
        status: "APPROVED",
        orderDate: new Date(),
        lines: { create: [{ itemId: item.id, quantity: 100, width: 150 }] },
      },
      select: { id: true },
    });
    orderIds.push(order.id);
    const sh = (await ship.createShipment({ orderIds: [order.id] })).data as { id: string };
    shipmentIds.push(sh.id);
    const sack = (await ship.addSack({ shipmentId: sh.id })).data as { id: string };
    await ship.scanIntoShipment({ shipmentId: sh.id, barcode: r2.barcode, sackId: sack.id });
    await inv.applyManualProperties(r2.id, { colorId: colorB.id, propertyIds: [] }, undefined);
    const r2After = await prisma.roll.findUnique({ where: { id: r2.id }, select: { colorId: true } });
    check("PREPARING sevkiyattaki top relabel edildi", r2After?.colorId === colorB.id);
    void sh1;

    // 4) READY sevkiyattaki top relabel reddedilir
    await ship.updateSack({ sackId: sack.id, weightKg: 30, manualCode: `RLB${ts}` });
    await ship.markReady(sh.id);
    let rejected = false;
    try {
      await inv.applyManualProperties(r2.id, { colorId: colorA.id, propertyIds: [] }, undefined);
    } catch (e) {
      rejected = (e as { statusCode?: number }).statusCode === 409;
    }
    check("READY (commit'li) sevkiyattaki top relabel 409", rejected);

    // 6) Metraj (currentQty) düzeltmesi — bütün topta initialQty ile BİRLİKTE güncellenir
    await inv.applyManualProperties(r3.id, { colorId: colorA.id, propertyIds: [], currentQty: 250 }, undefined);
    const r3After = await prisma.roll.findUnique({
      where: { id: r3.id },
      select: { currentQty: true, initialQty: true },
    });
    check(
      "Metraj değişti (100→250) + initialQty senkron",
      Number(r3After?.currentQty) === 250 && Number(r3After?.initialQty) === 250,
    );

    // 7) Kısmen tüketilmiş top (currentQty < initialQty) → metraj düzeltme REDDEDİLİR (409)
    await prisma.roll.update({ where: { id: r3.id }, data: { currentQty: 200, initialQty: 250 } });
    let metrajRejected = false;
    try {
      await inv.applyManualProperties(r3.id, { colorId: colorA.id, propertyIds: [], currentQty: 300 }, undefined);
    } catch (e) {
      metrajRejected = (e as { statusCode?: number }).statusCode === 409;
    }
    check("Kısmen tüketilmiş topta metraj düzeltme 409", metrajRejected);

    // 7b) Metraj GÖNDERİLMEZSE (renk-only) kısmi topta bile relabel geçer (guard sadece metraja)
    await inv.applyManualProperties(r3.id, { colorId: colorB.id, propertyIds: [] }, undefined);
    const r3ColorOnly = await prisma.roll.findUnique({ where: { id: r3.id }, select: { colorId: true } });
    check("Kısmi topta metrajsız (renk-only) relabel geçer", r3ColorOnly?.colorId === colorB.id);

    // 8) Etiket bayat bayrağı — relabel edilen top labelDirty=true olur
    const r1Dirty = await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true } });
    check("Relabel sonrası labelDirty=true", r1Dirty?.labelDirty === true);

    // 9) Etiket basılınca (recordPrintEvent) labelDirty=false'a döner
    const label = new LabelService();
    await label.recordPrintEvent(r1.id, undefined, { stock: true });
    const r1Clean = await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true } });
    check("Baskı sonrası labelDirty=false", r1Clean?.labelDirty === false);

    // 10) No-op relabel (aynı değerler) → labelDirty set edilmez (temiz kalır)
    const r1Cur = await prisma.roll.findUnique({
      where: { id: r1.id },
      select: { colorId: true, width: true, qualityGrade: true, properties: { select: { propertyId: true } } },
    });
    await inv.applyManualProperties(
      r1.id,
      {
        colorId: r1Cur!.colorId,
        propertyIds: r1Cur!.properties.map((p) => p.propertyId),
        width: r1Cur!.width != null ? Number(r1Cur!.width) : null,
        qualityGrade: r1Cur!.qualityGrade,
      },
      undefined,
    );
    const r1Noop = await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true } });
    check("No-op relabel labelDirty set etmez (temiz kalır)", r1Noop?.labelDirty === false);
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
    for (const id of orderIds) {
      await prisma.orderLine.deleteMany({ where: { orderId: id } });
      await prisma.order.delete({ where: { id } }).catch(() => {});
    }
    await prisma.color.deleteMany({ where: { id: { in: [colorA.id, colorB.id] } } });
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
