// Çuval Depo modeli (mühür/rezerv YOK, kapı önü YOK) yaşam döngüsü testi.
// Çalıştırma:  npx tsx scripts/test_sack_pool_lifecycle.ts
// Seed master-data (Item/Customer) kullanır; ürettiği Order/Roll/Sack/Shipment'ları temizler.
// Her senaryo AYRI spec (width) kullanır → serbest stok karışması olmaz.
//
// Sevk onayı bayrağı (shipping.confirmationEnabled):
//   • KAPALI (varsayılan): createShipment çuvalları DOĞRUDAN sevk eder (DISPATCHED) — tek adım.
//   • AÇIK: createShipment PLANNED kurar; ayrıca dispatchShipment ile onaylanır (iki adım).
// AT_DOOR (kapı önü) durumu YOK.
//
// Doğrulananlar:
//   A. Onay KAPALI: seç → doğrudan sevk (DISPATCHED + shippedQty + SHIPPED, tek adımda).
//   B. Alt küme: çok çuval → biri doğrudan sevk, diğerleri depoda kalır.
//   D. Fazla mal: tahsis need'de kapanır, fazlası yine sevk (önizleme uyarısı).
//   E. Siparişsiz doğrudan sevk: hiçbir siparişten düşmez.
//   F. Bir çuval iki siparişe: spec+FIFO ile erken-termin önce dolar.
//   G. Müşterisiz çuval: müşteri sevkte atanır (backfill).
//   H. Onay AÇIK: createShipment PLANNED kurar → shippedQty=0 → dispatchShipment → DISPATCHED.
//   I. Onay AÇIK: PLANNED sevkiyat iptal → çuval depoya döner, tahsis silinir.
//   J. Çuvalı dağıt (seçili/tümü → depo) + seçili topları başka çuvala toplu taşı + sevkteki çuval guard'ı.

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

type CreatedShipment = { data: { id: string; status: ShipmentStatus; dispatched: boolean } };
async function createShip(sackIds: string[], orderIds?: string[]): Promise<CreatedShipment> {
  const res = (await ship.createShipment({ sackIds, customerId, orderIds })) as CreatedShipment;
  createdShipments.push(res.data.id);
  return res;
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
const rollIdOf = async (barcode: string) =>
  (await prisma.roll.findUnique({ where: { barcode }, select: { id: true } }))!.id;
const sackRollCount = async (sackId: string) => prisma.roll.count({ where: { sackId } });

async function main() {
  console.log("=== Çuval Depo Yaşam Döngüsü Testi ===\n");
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id; customerId = cust.id;

  // ═══ SEVK ONAYI KAPALI (varsayılan): createShipment DOĞRUDAN sevk eder ═══
  await setFlag(false);

  // ── A: doğrudan sevk (width 201) ──
  console.log("--- A: onay kapalı → seç → doğrudan sevk (tek adım) ---");
  {
    const W = 201;
    const { orderId, lineId } = await makeOrder(1000, W);
    const b1 = await makeRoll(60, W), b2 = await makeRoll(40, W);
    const sackId = await filledSack([b1, b2]);
    const created = await createShip([sackId], [orderId]);
    check("A1 createShipment DOĞRUDAN DISPATCHED", created.data.status === ShipmentStatus.DISPATCHED, created.data.status);
    check("A2 shippedQty=100 (tek adımda düştü)", (await shippedOf(lineId)) === 100, `shipped=${await shippedOf(lineId)}`);
    check("A3 SackAllocation=100", (await allocOf(lineId)) === 100);
    check("A4 top SHIPPED", (await rollState(b1)).status === RollStatus.SHIPPED);
    check("A5 çuval sevkiyata atandı", (await sackState(sackId)).shipmentId === created.data.id);
    check("A6 ShipmentOrder=1", (await prisma.shipmentOrder.count({ where: { shipmentId: created.data.id } })) === 1);
    const ord = await prisma.order.findFirst({ where: { lines: { some: { id: lineId } } }, select: { status: true } });
    check("A7 sipariş PARTIAL_SHIPPED", ord!.status === OrderStatus.PARTIAL_SHIPPED);
  }

  // ── B: alt küme doğrudan sevk (width 202) ──
  console.log("\n--- B: çok çuval → biri doğrudan sevk, diğerleri depoda ---");
  {
    const W = 202;
    const { orderId, lineId } = await makeOrder(1000, W);
    const sackA = await filledSack([await makeRoll(50, W)]);
    const sackB = await filledSack([await makeRoll(50, W)]);
    const sackC = await filledSack([await makeRoll(50, W)]);
    await createShip([sackA], [orderId]);
    check("B1 shippedQty=50 (yalnız sackA)", (await shippedOf(lineId)) === 50, `shipped=${await shippedOf(lineId)}`);
    check("B2 sackB/sackC depoda", (await sackState(sackB)).shipmentId === null && (await sackState(sackC)).shipmentId === null);
  }

  // ── D: fazla mal doğrudan sevk (width 204) ──
  console.log("\n--- D: fazla mal → tahsis kapanır, önizleme uyarı verir, yine sevk ---");
  {
    const W = 204;
    const { orderId, lineId } = await makeOrder(100, W);
    const b = await makeRoll(160, W);
    const sackId = await filledSack([b]);
    const preview = (await ship.previewCreateShipment({ sackIds: [sackId], customerId, orderIds: [orderId] })) as { data: { lines: { allocated: number; need: number }[]; warnings: string[]; totals: { surplusMeters: number } } };
    check("D1 önizleme: allocated=100 need=100", preview.data.lines[0]?.allocated === 100 && preview.data.lines[0]?.need === 100);
    check("D2 önizleme: surplus=60 + uyarı", preview.data.totals.surplusMeters === 60 && preview.data.warnings.length > 0, `surplus=${preview.data.totals.surplusMeters}`);
    await createShip([sackId], [orderId]);
    check("D3 shippedQty=100 (need'de kapandı)", (await shippedOf(lineId)) === 100, `shipped=${await shippedOf(lineId)}`);
    check("D4 fazla top yine SHIPPED", (await rollState(b)).status === RollStatus.SHIPPED);
  }

  // ── E: siparişsiz doğrudan sevk (width 205) ──
  console.log("\n--- E: sipariş seçmeden doğrudan sevk → hiçbir siparişten düşmez ---");
  {
    const W = 205;
    const { lineId } = await makeOrder(1000, W);
    const b = await makeRoll(50, W);
    const created = await createShip([await filledSack([b])]);
    check("E1 ShipmentOrder=0", (await prisma.shipmentOrder.count({ where: { shipmentId: created.data.id } })) === 0);
    check("E2 top SHIPPED", (await rollState(b)).status === RollStatus.SHIPPED);
    check("E3 sipariş shippedQty=0 (dokunulmadı)", (await shippedOf(lineId)) === 0);
  }

  // ── F: bir çuval iki siparişe (spec+FIFO split) → doğrudan sevk (width 206) ──
  console.log("\n--- F: bir çuval iki siparişe → erken termin önce dolar ---");
  {
    const W = 206;
    const a = await makeOrder(100, W, 1);
    const b = await makeOrder(100, W, 30);
    await createShip([await filledSack([await makeRoll(150, W)])], [a.orderId, b.orderId]);
    check("F1 a.shipped=100 (dolu), b.shipped=50 (kalan)", (await shippedOf(a.lineId)) === 100 && (await shippedOf(b.lineId)) === 50, `a=${await shippedOf(a.lineId)} b=${await shippedOf(b.lineId)}`);
  }

  // ── G: müşterisiz çuval → sevkte müşteri backfill (width 207) ──
  console.log("\n--- G: müşterisiz çuval → sevkte müşteri atanır ---");
  {
    const W = 207;
    const { orderId, lineId } = await makeOrder(1000, W);
    const sackId = await filledSack([await makeRoll(40, W)], false);
    check("G1 çuval müşterisiz açıldı", (await sackState(sackId)).customerId === null);
    await createShip([sackId], [orderId]);
    check("G2 sevkte çuvala müşteri backfill", (await sackState(sackId)).customerId === customerId);
    check("G3 shippedQty=40", (await shippedOf(lineId)) === 40, `shipped=${await shippedOf(lineId)}`);
  }

  // ── J: çuvalı dağıt (seçili/tümü) + toplu taşı (width 210) — sevkiyat YOK ──
  console.log("\n--- J: çuvalı dağıt (seçili/tümü depoya) + seçili topları başka çuvala taşı ---");
  {
    const W = 210;
    const b1 = await makeRoll(30, W), b2 = await makeRoll(30, W), b3 = await makeRoll(30, W);
    const sackX = await filledSack([b1, b2, b3]);
    const sackY = await filledSack([]); // hedef (boş, aynı müşteri)
    check("J1 sackX 3 top ile doldu", (await sackRollCount(sackX)) === 3, `count=${await sackRollCount(sackX)}`);

    // Seçili dağıt: yalnız b1 → depoya
    await ship.distributeSackContents({ sackId: sackX, rollIds: [await rollIdOf(b1)] });
    check("J2 b1 depoya çıktı (sackId null)", (await rollState(b1)).sackId === null);
    check("J3 sackX'te 2 top kaldı", (await sackRollCount(sackX)) === 2, `count=${await sackRollCount(sackX)}`);

    // Toplu taşı: b2,b3 → sackY
    await ship.moveRollsToSack({ sackId: sackX, rollIds: [await rollIdOf(b2), await rollIdOf(b3)], targetSackId: sackY });
    check("J4 b2/b3 sackY'ye taşındı", (await rollState(b2)).sackId === sackY && (await rollState(b3)).sackId === sackY);
    check("J5 sackX boşaldı", (await sackRollCount(sackX)) === 0, `count=${await sackRollCount(sackX)}`);

    // Tümünü dağıt: sackY → depoya (seçim vermeden)
    const res = (await ship.distributeSackContents({ sackId: sackY })) as { data: { removedRolls: number } };
    check("J6 tümü dağıtıldı: removedRolls=2", res.data.removedRolls === 2, `removed=${res.data.removedRolls}`);
    check("J7 sackY boşaldı + b2/b3 depoda", (await sackRollCount(sackY)) === 0 && (await rollState(b2)).sackId === null);

    // Guard: sevkiyattaki çuval dağıtılamaz (onay kapalı → doğrudan DISPATCHED)
    const b4 = await makeRoll(20, W);
    const sackZ = await filledSack([b4]);
    await createShip([sackZ]);
    let guarded = false;
    try { await ship.distributeSackContents({ sackId: sackZ }); } catch { guarded = true; }
    check("J8 sevkiyattaki çuval dağıtılamaz (guard)", guarded);
  }

  // ═══ SEVK ONAYI AÇIK: createShipment PLANNED kurar, ayrıca dispatch ═══
  await setFlag(true);

  // ── H: onay açık → PLANNED → dispatch (width 208) ──
  console.log("\n--- H: onay AÇIK → PLANNED kurulur → ayrıca dispatch ---");
  {
    const W = 208;
    const { orderId, lineId } = await makeOrder(1000, W);
    const sackId = await filledSack([await makeRoll(60, W)]);
    const created = await createShip([sackId], [orderId]);
    check("H1 createShipment PLANNED (doğrudan sevk DEĞİL)", created.data.status === ShipmentStatus.PLANNED, created.data.status);
    check("H2 shippedQty=0 (henüz sevk edilmedi)", (await shippedOf(lineId)) === 0, `shipped=${await shippedOf(lineId)}`);
    check("H3 tahsis yazıldı (60)", (await allocOf(lineId)) === 60);
    await ship.dispatchShipment(created.data.id, {});
    check("H4 dispatch → DISPATCHED", (await statusOf(created.data.id)) === ShipmentStatus.DISPATCHED);
    check("H5 shippedQty=60 (terfi)", (await shippedOf(lineId)) === 60, `shipped=${await shippedOf(lineId)}`);
  }

  // ── I: onay açık → PLANNED → iptal (width 209) ──
  console.log("\n--- I: onay AÇIK → PLANNED sevkiyat iptal → çuval depoya döner ---");
  {
    const W = 209;
    const { orderId, lineId } = await makeOrder(1000, W);
    const sackId = await filledSack([await makeRoll(70, W)]);
    const created = await createShip([sackId], [orderId]);
    check("I1 tahsis yazıldı (70)", (await allocOf(lineId)) === 70);
    await ship.cancelShipment(created.data.id);
    check("I2 sevkiyat CANCELLED", (await statusOf(created.data.id)) === ShipmentStatus.CANCELLED);
    check("I3 çuval depoya döndü", (await sackState(sackId)).shipmentId === null);
    check("I4 tahsis silindi (0)", (await allocOf(lineId)) === 0);
    check("I5 shippedQty=0", (await shippedOf(lineId)) === 0);
  }

  await setFlag(false);
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
