// Çuval Havuzu (B modeli) yaşam döngüsü testi.
// Çalıştırma:  npx tsx scripts/test_sack_pool_lifecycle.ts
// Seed master-data (Item/Customer) kullanır; ürettiği Order/Roll/Sack/Shipment'ları temizler.
// Her senaryo AYRI spec (width) kullanır → havuz çapraz-karışması olmaz (rebalance müşteri-geneli FIFO).
//
// Doğrulananlar:
//   A. Havuz akışı: çuval aç → okut → mühürle → rebalance packedQty → sevkiyat (donma) →
//      dispatch (shippedQty terfi + rolls SHIPPED + packedQty→0).
//   B. KULLANICI SENARYOSU: çok çuval havuzda, ALT KÜME seçilip sevk → diğerleri havuzda kalır.
//   C. İptal: sevkiyat iptal → çuvallar havuza döner, rebalance rezerve çevirir.
//   D. Over-coverage: seal toplam > sipariş → packedQty need'de kapanır (aşmaz).
//   E. Mühür aç: reopen → rezerv geri alınır (packedQty düşer).
//   F. Sipariş kapanınca havuz rezervi başka açık siparişe akar (rebalance reallocation).

import { RollStatus, ShipmentStatus, OrderStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { rebalanceCustomerPool } from "../src/services/helpers/sack-allocation.helper";

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
      orderNumber: `TEST-POOL-${orderSeq}-${Math.floor(Math.random() * 1e6)}`,
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

async function sealedSack(barcodes: string[]): Promise<string> {
  const opened = (await ship.openSack({ customerId })) as { data: { id: string } };
  const sackId = opened.data.id;
  createdSacks.push(sackId);
  for (const bc of barcodes) await ship.scanIntoSack({ sackId, barcode: bc });
  await ship.sealSack({ sackId });
  return sackId;
}

const packedOf = async (lineId: string) =>
  Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { packedQty: true } }))!.packedQty);
const shippedOf = async (lineId: string) =>
  Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);
const statusOf = async (shipmentId: string) =>
  (await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } }))!.status;
const rollState = async (barcode: string) =>
  (await prisma.roll.findUnique({ where: { barcode }, select: { status: true, shipmentId: true, sackId: true } }))!;
const sackShipmentId = async (sackId: string) =>
  (await prisma.sack.findUnique({ where: { id: sackId }, select: { shipmentId: true } }))!.shipmentId;

async function main() {
  console.log("=== Çuval Havuzu Yaşam Döngüsü Testi ===\n");
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id; customerId = cust.id;
  await setFlag(false);

  // ── A: havuz → mühür → rebalance → sevkiyat → dispatch (width 201) ──
  console.log("--- A: çuval aç → mühürle → sevkiyat → dispatch ---");
  {
    const W = 201;
    const { lineId } = await makeOrder(1000, W);
    const b1 = await makeRoll(60, W), b2 = await makeRoll(40, W);
    const sackId = await sealedSack([b1, b2]);
    check("A1 mühür sonrası packedQty=100 (rebalance)", (await packedOf(lineId)) === 100, `packed=${await packedOf(lineId)}`);
    check("A2 shippedQty=0", (await shippedOf(lineId)) === 0);
    const r1 = await rollState(b1);
    check("A3 top WAREHOUSE + çuvalda + sevkiyatsız", r1.status === RollStatus.WAREHOUSE && r1.sackId === sackId && r1.shipmentId === null);

    const created = (await ship.createShipment({ sackIds: [sackId] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("A4 sevkiyat PLANNED", (await statusOf(shipmentId)) === ShipmentStatus.PLANNED);
    check("A5 sevkiyat sonrası packedQty hâlâ 100 (donmuş)", (await packedOf(lineId)) === 100);
    check("A6 çuval sevkiyata atandı", (await sackShipmentId(sackId)) === shipmentId);
    check("A7 top shipmentId set", (await rollState(b1)).shipmentId === shipmentId);
    check("A8 ShipmentOrder türetildi", (await prisma.shipmentOrder.count({ where: { shipmentId } })) === 1);

    await ship.dispatchShipment(shipmentId, {});
    check("A9 dispatch → DISPATCHED", (await statusOf(shipmentId)) === ShipmentStatus.DISPATCHED);
    check("A10 shippedQty=100 (terfi)", (await shippedOf(lineId)) === 100, `shipped=${await shippedOf(lineId)}`);
    check("A11 packedQty=0", (await packedOf(lineId)) === 0);
    check("A12 top SHIPPED", (await rollState(b1)).status === RollStatus.SHIPPED);
    const ord = await prisma.order.findFirst({ where: { lines: { some: { id: lineId } } }, select: { status: true } });
    check("A13 sipariş PARTIAL_SHIPPED", ord!.status === OrderStatus.PARTIAL_SHIPPED);
  }

  // ── B: KULLANICI SENARYOSU — çok çuval, ALT KÜME sevk (width 202) ──
  console.log("\n--- B: çok çuval havuzda → alt küme seç → sevk ---");
  {
    const W = 202;
    const { lineId } = await makeOrder(1000, W);
    const sackA = await sealedSack([await makeRoll(50, W)]);
    const sackB = await sealedSack([await makeRoll(50, W)]);
    const sackC = await sealedSack([await makeRoll(50, W)]);
    check("B1 3 mühürlü çuval → packedQty=150", (await packedOf(lineId)) === 150, `packed=${await packedOf(lineId)}`);

    const created = (await ship.createShipment({ sackIds: [sackA] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("B2 yalnız sackA sevkiyatta", (await sackShipmentId(sackA)) === shipmentId);
    check("B3 sackB/sackC havuzda", (await sackShipmentId(sackB)) === null && (await sackShipmentId(sackC)) === null);
    check("B4 packedQty hâlâ 150 (1 donmuş + 2 havuz)", (await packedOf(lineId)) === 150, `packed=${await packedOf(lineId)}`);

    await ship.dispatchShipment(shipmentId, {});
    check("B5 dispatch → shippedQty=50", (await shippedOf(lineId)) === 50, `shipped=${await shippedOf(lineId)}`);
    check("B6 packedQty=100 (kalan 2 havuz)", (await packedOf(lineId)) === 100, `packed=${await packedOf(lineId)}`);
  }

  // ── C: iptal → çuval havuza döner (width 203) ──
  console.log("\n--- C: sevkiyat iptal → çuval havuza döner ---");
  {
    const W = 203;
    const { lineId } = await makeOrder(1000, W);
    const sackId = await sealedSack([await makeRoll(70, W)]);
    const created = (await ship.createShipment({ sackIds: [sackId] })) as { data: { id: string } };
    const shipmentId = created.data.id; createdShipments.push(shipmentId);
    check("C1 sevkiyata atandı", (await sackShipmentId(sackId)) === shipmentId);
    await ship.cancelShipment(shipmentId);
    check("C2 sevkiyat CANCELLED", (await statusOf(shipmentId)) === ShipmentStatus.CANCELLED);
    check("C3 çuval havuza döndü", (await sackShipmentId(sackId)) === null);
    check("C4 packedQty hâlâ 70 (havuz rezervi)", (await packedOf(lineId)) === 70, `packed=${await packedOf(lineId)}`);
  }

  // ── D: over-coverage (width 204) ──
  console.log("\n--- D: over-coverage → packedQty need'i aşmaz ---");
  {
    const W = 204;
    const { lineId } = await makeOrder(100, W);
    await sealedSack([await makeRoll(80, W)]);
    await sealedSack([await makeRoll(80, W)]); // 160 seal, need 100
    check("D1 packedQty=100 (fazla mal tahsis edilmez)", (await packedOf(lineId)) === 100, `packed=${await packedOf(lineId)}`);
  }

  // ── E: mühür aç → rezerv geri alınır (width 205) ──
  console.log("\n--- E: mühür aç → packedQty düşer ---");
  {
    const W = 205;
    const { lineId } = await makeOrder(1000, W);
    const sackId = await sealedSack([await makeRoll(55, W)]);
    check("E1 mühür sonrası packedQty=55", (await packedOf(lineId)) === 55, `packed=${await packedOf(lineId)}`);
    await ship.reopenSack({ sackId });
    check("E2 mühür açılınca packedQty=0", (await packedOf(lineId)) === 0, `packed=${await packedOf(lineId)}`);
  }

  // ── F: sipariş kapanınca rezerv başka açık siparişe akar (width 206) ──
  console.log("\n--- F: sipariş kapandı → havuz rezervi başka siparişe akar ---");
  {
    const W = 206;
    const a = await makeOrder(100, W, 1);   // erken termin → FIFO önce
    const b = await makeOrder(100, W, 30);  // geç termin
    await sealedSack([await makeRoll(100, W)]);
    check("F1 rezerv erken-terminli siparişe (a) gitti", (await packedOf(a.lineId)) === 100 && (await packedOf(b.lineId)) === 0, `a=${await packedOf(a.lineId)} b=${await packedOf(b.lineId)}`);
    // a'yı kapat + rebalance (softDelete'in rebalance kancasının çekirdeği).
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: a.orderId }, data: { status: OrderStatus.CANCELLED } });
      await rebalanceCustomerPool(tx, customerId);
    });
    check("F2 a kapandı → rezerv b'ye aktı", (await packedOf(b.lineId)) === 100 && (await packedOf(a.lineId)) === 0, `a=${await packedOf(a.lineId)} b=${await packedOf(b.lineId)}`);
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
