// =============================================================================
// Test: Saha #3 — çuval eksiltme / transfer / takas (READY-farkındalı)
// Çalıştır: npx tsx scripts/test_sack_edit_ops.ts
// Kurulum: sipariş (200m, itemA/renksiz/150cm) + sevkiyat + 2 çuval (tartılı+kodlu)
//          Çuval-1: r1(100m)+r2(50m, itemA), Çuval-2: r3(70m itemA)
// Doğrulananlar:
//   1. markReady → commit (shippedQty=200'e kadar tahsis)
//   2. READY'de removeRoll → çalışır, shippedQty AZALIR (recommit), çuval tartısı sıfır
//   3. READY'de moveRollToSack → çalışır, iki çuvalın tartısı sıfır, recommit YOK ihtiyacı
//   4. Boşalan çuval READY'de otomatik silinir
//   5. swapRollSacks → sackId'ler değişti, tartılar sıfır
//   6. Farklı sevkiyattaki toplarla swap → 400
//   7. DISPATCHED'da remove → 409
//   8. PREPARING'de boşalan çuval SİLİNMEZ
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

async function main() {
  const ts = Date.now();
  const svc = new ShippingService();

  const customer = await prisma.customer.create({
    data: { code: `TST-SED-${ts}`, name: "TEST ÇUVAL DÜZELT" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-SED-I-${ts}`, name: "TEST SED ÜRÜN", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-SED-${ts}`,
      customerId: customer.id,
      status: "APPROVED",
      orderDate: new Date(),
      lines: { create: [{ itemId: item.id, quantity: 200, width: 150 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  const lineId = order.lines[0].id;
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-SED-${ts}`,
      customerId: customer.id,
      status: "PREPARING",
      orders: { create: [{ orderId: order.id }] },
    },
    select: { id: true },
  });
  const sack1 = await prisma.sack.create({
    data: { sackNo: `TEST-SED-SK1-${ts}`, shipmentId: shipment.id, seq: 1, manualCode: `SED${ts}1`, weightKg: 25 },
    select: { id: true },
  });
  const sack2 = await prisma.sack.create({
    data: { sackNo: `TEST-SED-SK2-${ts}`, shipmentId: shipment.id, seq: 2, manualCode: `SED${ts}2`, weightKg: 18 },
    select: { id: true },
  });
  const mkRoll = (n: number, sackId: string, qty: number) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-SED-R${n}-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        currentQty: qty,
        initialQty: qty,
        width: 150,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: shipment.id,
        sackId,
      },
      select: { id: true, barcode: true },
    });
  const r1 = await mkRoll(1, sack1.id, 100);
  const r2 = await mkRoll(2, sack1.id, 50);
  const r3 = await mkRoll(3, sack2.id, 70);

  const shippedQty = async () =>
    Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);
  const sackWeight = async (id: string) => {
    const s = await prisma.sack.findUnique({ where: { id }, select: { weightKg: true } });
    return s ? (s.weightKg === null ? null : Number(s.weightKg)) : undefined; // undefined = silinmiş
  };

  try {
    // 1) markReady → commit
    await svc.markReady(shipment.id);
    check("markReady commit etti (shippedQty=200)", (await shippedQty()) === 200, String(await shippedQty()));

    // 2) READY'de remove r2 (50m) → kalan 170m, satır kapasitesi 200 → tahsis 170
    await svc.removeRollFromShipment({ shipmentId: shipment.id, rollId: r2.id });
    check("READY'de top çıkarıldı + recommit (shippedQty 200→170)", (await shippedQty()) === 170, String(await shippedQty()));
    check("İçeriği değişen Çuval-1 tartısı sıfırlandı", (await sackWeight(sack1.id)) === null);
    const r2After = await prisma.roll.findUnique({ where: { id: r2.id }, select: { shipmentId: true, sackId: true } });
    check("Çıkan top serbest depoya döndü", r2After?.shipmentId === null && r2After?.sackId === null);

    // 3) READY'de transfer: r1 → Çuval-2
    await prisma.sack.update({ where: { id: sack1.id }, data: { weightKg: 20 } }); // tartıyı geri koy (taşıma da sıfırlamalı)
    await svc.moveRollToSack({ rollId: r1.id, sackId: sack2.id });
    const r1After = await prisma.roll.findUnique({ where: { id: r1.id }, select: { sackId: true } });
    check("READY'de top Çuval-2'ye taşındı", r1After?.sackId === sack2.id);
    check("Hedef Çuval-2 tartısı sıfırlandı", (await sackWeight(sack2.id)) === null);

    // 4) Boşalan Çuval-1 READY'de otomatik silindi
    check("Boşalan Çuval-1 READY'de otomatik silindi", (await sackWeight(sack1.id)) === undefined);
    check("Taşıma karşılanmayı DEĞİŞTİRMEDİ (170 sabit)", (await shippedQty()) === 170);

    // 5) Takas: yeni Çuval-3 aç, r3'ü oraya koy, r1 (Çuval-2) ile takas et
    const sack3 = await prisma.sack.create({
      data: { sackNo: `TEST-SED-SK3-${ts}`, shipmentId: shipment.id, seq: 3, manualCode: `SED${ts}3`, weightKg: 9 },
      select: { id: true },
    });
    await prisma.roll.update({ where: { id: r3.id }, data: { sackId: sack3.id } });
    await prisma.sack.update({ where: { id: sack2.id }, data: { weightKg: 11 } });
    await svc.swapRollSacks({ rollAId: r1.id, rollBId: r3.id });
    const r1Sw = await prisma.roll.findUnique({ where: { id: r1.id }, select: { sackId: true } });
    const r3Sw = await prisma.roll.findUnique({ where: { id: r3.id }, select: { sackId: true } });
    check("Takas: r1↔r3 çuvalları değişti", r1Sw?.sackId === sack3.id && r3Sw?.sackId === sack2.id);
    check(
      "Takas iki çuvalın tartısını sıfırladı",
      (await sackWeight(sack2.id)) === null && (await sackWeight(sack3.id)) === null,
    );

    // 6) Farklı sevkiyattaki topla takas → 400
    const otherShipment = await prisma.shipment.create({
      data: { shipmentNo: `TEST-SED-O-${ts}`, customerId: customer.id, status: "PREPARING" },
      select: { id: true },
    });
    const otherSack = await prisma.sack.create({
      data: { sackNo: `TEST-SED-OSK-${ts}`, shipmentId: otherShipment.id, seq: 1 },
      select: { id: true },
    });
    const rX = await prisma.roll.create({
      data: {
        barcode: `TEST-SED-RX-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        currentQty: 10,
        initialQty: 10,
        width: 150,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: otherShipment.id,
        sackId: otherSack.id,
      },
      select: { id: true },
    });
    let crossErr = false;
    try {
      await svc.swapRollSacks({ rollAId: r1.id, rollBId: rX.id });
    } catch (e) {
      crossErr = (e as { statusCode?: number }).statusCode === 400;
    }
    check("Farklı sevkiyat takası 400 ile reddedildi", crossErr);

    // 7) DISPATCHED'da remove → 409
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "DISPATCHED" } });
    let dispErr = false;
    try {
      await svc.removeRollFromShipment({ shipmentId: shipment.id, rollId: r1.id });
    } catch (e) {
      dispErr = (e as { statusCode?: number }).statusCode === 409;
    }
    check("DISPATCHED'da top çıkarma 409", dispErr);
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "READY" } });

    // 8) PREPARING'de boşalan çuval silinmez
    let okPrep = false;
    try {
      await svc.removeRollFromShipment({ shipmentId: otherShipment.id, rollId: rX.id });
      okPrep = (await sackWeight(otherSack.id)) !== undefined; // çuval hâlâ var
    } catch {
      okPrep = false;
    }
    check("PREPARING'de boşalan çuval SİLİNMEDİ", okPrep);
  } finally {
    await prisma.shipmentAllocation.deleteMany({ where: { shipment: { shipmentNo: { startsWith: `TEST-SED` } } } });
    await prisma.roll.deleteMany({ where: { barcode: { startsWith: `TEST-SED-R` } } });
    await prisma.sack.deleteMany({ where: { sackNo: { startsWith: `TEST-SED-SK` } } });
    await prisma.sack.deleteMany({ where: { sackNo: { startsWith: `TEST-SED-OSK` } } });
    await prisma.shipmentOrder.deleteMany({ where: { orderId: order.id } });
    await prisma.shipment.deleteMany({ where: { shipmentNo: { contains: `TEST-SED` } } });
    await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
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
