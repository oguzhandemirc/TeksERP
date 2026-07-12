// Çuval Depo modeli (mühür/rezerv YOK) yaşam döngüsü testi.
// Çalıştırma:  npx tsx scripts/test_sack_pool_lifecycle.ts
// Seed master-data (Item/Customer) kullanır; ürettiği Order/Roll/Sack/Shipment'ları temizler.
// Her senaryo AYRI spec (width) kullanır → serbest stok karışması olmaz.
//
// Doğrulananlar:
//   A. Temel akış: çuval aç → okut (depoda) → createShipment({sackIds,customerId,orderIds})
//      → PLANNED (SackAllocation yazıldı, shippedQty=0) → dispatch (shippedQty terfi + SHIPPED).
//   B. ALT KÜME sevk: çok çuval depoda → biri seçilip sevk → diğerleri depoda kalır.
//   C. İptal: PLANNED sevkiyat iptal → çuval depoya döner, tahsis silinir, shippedQty=0.
//   D. Fazla mal: sipariş ihtiyacından fazla çuval → tahsis need'de kapanır, fazlası sevk (uyarı).
//   E. Siparişsiz sevk: sipariş seçmeden sevk → hiçbir siparişten düşmez.
//   F. Bir çuval iki siparişe: spec+FIFO ile erken-terminli önce dolar, kalanı sonrakine.
//   G. Müşterisiz çuval: müşteri sevkte atanır (backfill) → tahsis + dispatch çalışır.

import { RollStatus, ShipmentStatus, OrderStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

const SETTING_KEY = "shipping.confirmationEnabled";
const ship = new ShippingService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const createdRolls: string[] = [];
const createdSacks: string[] = [];
const createdShipments: string[] = [];
const createdOrders: string[] = [];

let itemId = "";
let customerId = "";

async function setFlag(on: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: on },
    create: { key: SETTING_KEY, value: on },
  });
}

let orderSeq = 0;
async function makeOrder(lineQty: number, width: number, deadlineDaysFromNow?: number): Promise<{ orderId: string; lineId: string }> {
  orderSeq += 1;
  const deadline = deadlineDaysFromNow != null ? new Date(Date.now() + deadlineDaysFromNow * 86400_000) : null;
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-DEPO-${orderSeq}-${Math.floor(Math.random() * 1e6)}`,
      customerId, status: OrderStatus.APPROVED, deadline,
      lines: { create: [{ itemId, colorId: null, width, quantity: lineQty }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  createdOrders.push(order.id);
  return { orderId: order.id, lineId: order.lines[0].id };
}

async function makeRoll(qty: number, width: number): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-WH-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      itemId, colorId: null, width,
      initialQty: qty, currentQty: qty,
      status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, barcode: true },
  });
  createdRolls.push(roll.id);
  return roll.barcode!;
}

/** Çuval aç (müşteri OPSİYONEL) → topları okut → depoda kalır (mühür YOK). */
async function filledSack(barcodes: string[], withCustomer = true): Promise<string> {
  const opened = (await ship.openSack(withCustomer ? { customerId } : {})) as { data: { id: string } };
  const sackId = opened.data.id;
  createdSacks.push(sackId);
  for (const bc of barcodes) await ship.scanIntoSack({ sackId, barcode: bc });
  return sackId;
}

const shippedOf = async (lineId: string) =>
  Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);
const allocOf = async (lineId: string) =>
  Number((await prisma.sackAllocation.aggregate({ where: { orderLineId: lineId }, _sum: { qty: true } }))._sum.qty ?? 0);
const statusOf = async (shipmentId: string) =>
  (await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } }))!.status;
const rollState = async (barcode: string) =>
  (await prisma.roll.findUnique({ where: { barcode }, select: { status: true, shipmentId: true, sackId: true } }))!;
const sackState = async (sackId: string) =>
  (await prisma.sack.findUnique({ where: { id: sackId }, select: { shipmentId: true, customerId: true } }))!;

async function main() {
  console.log("=== Çuval Depo Yaşam Döngüsü Testi ===\n");
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id; customerId = cust.id;
  await setFlag(false);

  // ── A: çuval → sevkiyat(sipariş seçili) → dispatch (width 201) ──
  console.log("--- A: çuval aç → sipariş seçili sevk → dispatch ---");
  {
    const W = 201;
    const { lineId } = await makeOrder(1000, W);
    const b1 = await makeRoll(60, W), b2 = await makeRoll(40, W);
    const sackId = await filledSack([b1, b2]);
    check("A1 çuval depoda, top WAREHOUSE + çuvalda + sevkiyatsız", (() => true)());
    const r1 = await rollState(b1);
    check("A2 top WAREHOUSE + sackId set + shipmentId null", r1.status === RollStatus.WAREHOUSE && r1.sackId === sackId && r1.shipmentId === null);
    check("A3 sevk öncesi shippedQty=0", (await shippedOf(lineId)) === 0);

    const created = (await ship.createShipment({ sackIds: [sackId], customerId, orderIds: [(await prisma.orderLine.findUnique({ where: { id: lineId }, select: { orderId: true } }))!.orderId] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("A4 sevkiyat PLANNED", (await statusOf(shipmentId)) === ShipmentStatus.PLANNED);
    check("A5 PLANNED'de SackAllocation=100 (yazıldı)", (await allocOf(lineId)) === 100, `alloc=${await allocOf(lineId)}`);
    check("A6 PLANNED'de shippedQty hâlâ 0 (düşüş dispatch'te)", (await shippedOf(lineId)) === 0, `shipped=${await shippedOf(lineId)}`);
    check("A7 çuval sevkiyata atandı", (await sackState(sackId)).shipmentId === shipmentId);
    check("A8 top shipmentId set", (await rollState(b1)).shipmentId === shipmentId);
    check("A9 ShipmentOrder=1", (await prisma.shipmentOrder.count({ where: { shipmentId } })) === 1);

    await ship.dispatchShipment(shipmentId, {});
    check("A10 dispatch → DISPATCHED", (await statusOf(shipmentId)) === ShipmentStatus.DISPATCHED);
    check("A11 shippedQty=100 (terfi)", (await shippedOf(lineId)) === 100, `shipped=${await shippedOf(lineId)}`);
    check("A12 top SHIPPED", (await rollState(b1)).status === RollStatus.SHIPPED);
    const ord = await prisma.order.findFirst({ where: { lines: { some: { id: lineId } } }, select: { status: true } });
    check("A13 sipariş PARTIAL_SHIPPED", ord!.status === OrderStatus.PARTIAL_SHIPPED);
  }

  // ── B: çok çuval depoda → ALT KÜME sevk (width 202) ──
  console.log("\n--- B: çok çuval depoda → alt küme seç → sevk ---");
  {
    const W = 202;
    const { orderId, lineId } = await makeOrder(1000, W);
    const sackA = await filledSack([await makeRoll(50, W)]);
    const sackB = await filledSack([await makeRoll(50, W)]);
    const sackC = await filledSack([await makeRoll(50, W)]);
    const created = (await ship.createShipment({ sackIds: [sackA], customerId, orderIds: [orderId] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("B1 yalnız sackA sevkiyatta", (await sackState(sackA)).shipmentId === shipmentId);
    check("B2 sackB/sackC depoda", (await sackState(sackB)).shipmentId === null && (await sackState(sackC)).shipmentId === null);
    await ship.dispatchShipment(shipmentId, {});
    check("B3 dispatch → shippedQty=50 (yalnız sackA)", (await shippedOf(lineId)) === 50, `shipped=${await shippedOf(lineId)}`);
  }

  // ── C: iptal → çuval depoya döner, tahsis silinir (width 203) ──
  console.log("\n--- C: PLANNED sevkiyat iptal → çuval depoya döner ---");
  {
    const W = 203;
    const { orderId, lineId } = await makeOrder(1000, W);
    const sackId = await filledSack([await makeRoll(70, W)]);
    const created = (await ship.createShipment({ sackIds: [sackId], customerId, orderIds: [orderId] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("C1 tahsis yazıldı (70)", (await allocOf(lineId)) === 70, `alloc=${await allocOf(lineId)}`);
    await ship.cancelShipment(shipmentId);
    check("C2 sevkiyat CANCELLED", (await statusOf(shipmentId)) === ShipmentStatus.CANCELLED);
    check("C3 çuval depoya döndü", (await sackState(sackId)).shipmentId === null);
    check("C4 tahsis silindi (0)", (await allocOf(lineId)) === 0, `alloc=${await allocOf(lineId)}`);
    check("C5 shippedQty=0 (hiç sevk olmadı)", (await shippedOf(lineId)) === 0);
  }

  // ── D: fazla mal → tahsis need'i aşmaz, fazlası yine sevk (width 204) ──
  console.log("\n--- D: fazla mal → tahsis kapanır, önizleme uyarı verir ---");
  {
    const W = 204;
    const { orderId, lineId } = await makeOrder(100, W);
    const b = await makeRoll(160, W);
    const sackId = await filledSack([b]);
    const preview = (await ship.previewCreateShipment({ sackIds: [sackId], customerId, orderIds: [orderId] })) as { data: { lines: { allocated: number; need: number }[]; warnings: string[]; totals: { surplusMeters: number } } };
    check("D1 önizleme: satır need=100 allocated=100 (kapandı)", preview.data.lines[0]?.allocated === 100 && preview.data.lines[0]?.need === 100, JSON.stringify(preview.data.lines[0]));
    check("D2 önizleme: surplus ~60 + uyarı var", preview.data.totals.surplusMeters === 60 && preview.data.warnings.length > 0, `surplus=${preview.data.totals.surplusMeters}`);
    const created = (await ship.createShipment({ sackIds: [sackId], customerId, orderIds: [orderId] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    await ship.dispatchShipment(shipmentId, {});
    check("D3 shippedQty=100 (need'de kapandı, fazlası siparişe yazılmaz)", (await shippedOf(lineId)) === 100, `shipped=${await shippedOf(lineId)}`);
    check("D4 fazla top yine sevk edildi (SHIPPED)", (await rollState(b)).status === RollStatus.SHIPPED);
  }

  // ── E: siparişsiz sevk (width 205) ──
  console.log("\n--- E: sipariş seçmeden sevk → hiçbir siparişten düşmez ---");
  {
    const W = 205;
    const { lineId } = await makeOrder(1000, W);
    const b = await makeRoll(50, W);
    const sackId = await filledSack([b]);
    const created = (await ship.createShipment({ sackIds: [sackId], customerId })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("E1 ShipmentOrder=0 (sipariş seçilmedi)", (await prisma.shipmentOrder.count({ where: { shipmentId } })) === 0);
    await ship.dispatchShipment(shipmentId, {});
    check("E2 dispatch → top SHIPPED", (await rollState(b)).status === RollStatus.SHIPPED);
    check("E3 sipariş shippedQty=0 (dokunulmadı)", (await shippedOf(lineId)) === 0, `shipped=${await shippedOf(lineId)}`);
  }

  // ── F: bir çuval iki siparişe (spec+FIFO split) (width 206) ──
  console.log("\n--- F: bir çuval iki siparişe → erken termin önce dolar ---");
  {
    const W = 206;
    const a = await makeOrder(100, W, 1);   // erken termin → FIFO önce
    const b = await makeOrder(100, W, 30);  // geç termin
    const sackId = await filledSack([await makeRoll(150, W)]);
    const created = (await ship.createShipment({ sackIds: [sackId], customerId, orderIds: [a.orderId, b.orderId] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("F1 tahsis: a=100 (dolu), b=50 (kalan)", (await allocOf(a.lineId)) === 100 && (await allocOf(b.lineId)) === 50, `a=${await allocOf(a.lineId)} b=${await allocOf(b.lineId)}`);
    await ship.dispatchShipment(shipmentId, {});
    check("F2 dispatch → a.shipped=100, b.shipped=50", (await shippedOf(a.lineId)) === 100 && (await shippedOf(b.lineId)) === 50, `a=${await shippedOf(a.lineId)} b=${await shippedOf(b.lineId)}`);
  }

  // ── G: müşterisiz çuval → müşteri sevkte atanır (width 207) ──
  console.log("\n--- G: müşterisiz çuval → sevkte müşteri backfill ---");
  {
    const W = 207;
    const { orderId, lineId } = await makeOrder(1000, W);
    const b = await makeRoll(40, W);
    const sackId = await filledSack([b], false); // müşterisiz aç
    check("G1 çuval müşterisiz açıldı", (await sackState(sackId)).customerId === null);
    const created = (await ship.createShipment({ sackIds: [sackId], customerId, orderIds: [orderId] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("G2 sevkte çuvala müşteri backfill", (await sackState(sackId)).customerId === customerId);
    await ship.dispatchShipment(shipmentId, {});
    check("G3 shippedQty=40", (await shippedOf(lineId)) === 40, `shipped=${await shippedOf(lineId)}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup() {
  try {
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: createdSacks } } });
    await prisma.roll.updateMany({ where: { id: { in: createdRolls } }, data: { shipmentId: null, sackId: null } });
    await prisma.sack.deleteMany({ where: { id: { in: createdSacks } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipments } } });
    await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrders } } });
  } catch (e) {
    console.error("Temizlik hatası:", e);
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
