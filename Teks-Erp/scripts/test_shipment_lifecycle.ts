// Sevkiyat yaşam döngüsü testi — yeni model (Çuval Depo / Kapı Önü / Alındı).
// Çalıştırma:  npx ts-node scripts/test_shipment_lifecycle.ts
// Mevcut Customer + Item kullanır; ürettiği Order/Roll/Shipment'ları sonunda temizler.
//
// Doğrulananlar:
//   1. Commit "Sevke Hazır"da (PREPARING→READY) yazılır → shippedQty artar (MRP karşılandı sayar).
//   2. Çuvallanan top serbest stoktan (WAREHOUSE+shipmentId null) düşer ama WAREHOUSE kalır.
//   3. Kapı Önüne Koy (READY→AT_DOOR) çift commit YAPMAZ (shippedQty değişmez).
//   4. Fiziksel stok (WAREHOUSE→SHIPPED) yalnız DISPATCH'te düşer.
//   5. Sevk onayı bayrağı AÇIK → dispatch yalnız AT_DOOR'dan; READY'den reddedilir.
//   6. unready (READY→PREPARING) commit'i geri alır (shippedQty düşer).
//   7. PREPARING'den direkt sevk (bayrak kapalı) tek adımda commit+SHIPPED.
//   8. getWarehouseScope serbest/çuval depo/kapı önü sayaçları doğru kayar.

import { RollStatus, ShipmentStatus, OrderStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";

const SETTING_KEY = "shipping.confirmationEnabled";
const ship = new ShippingService();
const inv = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const createdRolls: string[] = [];
const createdShipments: string[] = [];
const createdOrders: string[] = [];

async function setFlag(on: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: on },
    create: { key: SETTING_KEY, value: on },
  });
}

let WIDTH = 150;
let itemId = "";
let customerId = "";

// Belirli metrajlı WAREHOUSE topları + sipariş satırı yaratır (spec eşleşir: item|null|WIDTH).
async function setup(
  qtys: number[],
  lineQty = 1000
): Promise<{ orderId: string; lineId: string; rollIds: string[] }> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-SHIP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
      status: OrderStatus.APPROVED,
      lines: { create: [{ itemId, colorId: null, width: WIDTH, quantity: lineQty }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  createdOrders.push(order.id);
  const rollIds: string[] = [];
  for (const q of qtys) {
    const roll = await prisma.roll.create({
      data: {
        barcode: `TEST-WH-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
        itemId,
        colorId: null,
        width: WIDTH,
        initialQty: q,
        currentQty: q,
        status: RollStatus.WAREHOUSE,
        qualityGrade: "1.KALITE",
        entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      },
      select: { id: true },
    });
    rollIds.push(roll.id);
    createdRolls.push(roll.id);
  }
  return { orderId: order.id, lineId: order.lines[0].id, rollIds };
}

// Sevkiyat aç + tek çuvala topları okut + tart/kodla → finalize'a hazır.
async function packShipment(orderId: string, rollIds: string[]): Promise<string> {
  const created = (await ship.createShipment({ orderIds: [orderId] })) as { data: { id: string } };
  const shipmentId = created.data.id;
  createdShipments.push(shipmentId);
  const sackRes = (await ship.addSack({ shipmentId })) as { data: { id: string } };
  const sackId = sackRes.data.id;
  for (const rid of rollIds) {
    const r = await prisma.roll.findUnique({ where: { id: rid }, select: { barcode: true } });
    await ship.scanIntoShipment({ shipmentId, barcode: r!.barcode!, sackId });
  }
  await ship.updateSack({ sackId, weightKg: 42, manualCode: `KOD-${Math.floor(Math.random() * 1e5)}` });
  return shipmentId;
}

const shippedQtyOf = async (lineId: string) =>
  Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);
const statusOf = async (shipmentId: string) =>
  (await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } }))!.status;
const rollState = async (id: string) =>
  (await prisma.roll.findUnique({ where: { id }, select: { status: true, shipmentId: true, sackId: true } }))!;

async function main() {
  console.log("=== Sevkiyat Yaşam Döngüsü Testi ===\n");
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id;
  customerId = cust.id;

  // ── Senaryo A: Çuval Depo (commit) → Kapı Önü → Alındı (bayrak KAPALI) ──
  console.log("\n--- A: Çuval Depo → Kapı Önü → Alındı (onay kapalı) ---");
  await setFlag(false);
  {
    const { orderId, lineId, rollIds } = await setup([44.5, 50.5]); // 95m
    const before = (await inv.getWarehouseScope()).data;
    const shipmentId = await packShipment(orderId, rollIds);

    await ship.markReady(shipmentId);
    check("A1 markReady → READY", (await statusOf(shipmentId)) === ShipmentStatus.READY);
    check("A2 commit: shippedQty=95 (çuvallamada karşılandı)", (await shippedQtyOf(lineId)) === 95);
    const rs = await Promise.all(rollIds.map(rollState));
    check("A3 toplar WAREHOUSE kaldı (SHIPPED değil)", rs.every((r) => r.status === RollStatus.WAREHOUSE));
    check("A4 toplar shipmentId+sackId dolu (committed)", rs.every((r) => r.shipmentId && r.sackId));
    const freeCommitted = await prisma.roll.count({
      where: { id: { in: rollIds }, status: RollStatus.WAREHOUSE, shipmentId: null },
    });
    check("A5 serbest depodan düştü (WAREHOUSE+shipmentId null = 0)", freeCommitted === 0);
    const afterReady = (await inv.getWarehouseScope()).data;
    check("A6 scope: çuval depo +2", afterReady.sackStore.count - before.sackStore.count === 2);

    await ship.moveToDoor(shipmentId);
    check("A7 moveToDoor → AT_DOOR", (await statusOf(shipmentId)) === ShipmentStatus.AT_DOOR);
    check("A8 çift commit yok (shippedQty hâlâ 95)", (await shippedQtyOf(lineId)) === 95);
    const afterDoor = (await inv.getWarehouseScope()).data;
    check("A9 scope: kapı önü +2", afterDoor.atDoor.count - before.atDoor.count === 2);

    await ship.dispatchShipment(shipmentId, {});
    check("A10 dispatch → DISPATCHED", (await statusOf(shipmentId)) === ShipmentStatus.DISPATCHED);
    const rs2 = await Promise.all(rollIds.map(rollState));
    check("A11 fiziksel stok çıktı: toplar SHIPPED", rs2.every((r) => r.status === RollStatus.SHIPPED));
    check("A12 dispatch'te çift commit yok (shippedQty 95)", (await shippedQtyOf(lineId)) === 95);
  }

  // ── Senaryo B: Bayrak AÇIK → READY'den dispatch REDDEDİLİR, kapı önünden geçer ──
  console.log("\n--- B: Sevk onayı AÇIK (kapı önü zorunlu) ---");
  await setFlag(true);
  {
    const { orderId, lineId, rollIds } = await setup([30]);
    const shipmentId = await packShipment(orderId, rollIds);
    await ship.markReady(shipmentId);
    let rejected = false;
    try {
      await ship.dispatchShipment(shipmentId, {});
    } catch {
      rejected = true;
    }
    check("B1 onay açık: READY'den dispatch reddedildi", rejected);
    check("B2 READY hâlâ READY (sevk olmadı)", (await statusOf(shipmentId)) === ShipmentStatus.READY);
    await ship.moveToDoor(shipmentId);
    await ship.dispatchShipment(shipmentId, {});
    check("B3 kapı önünden 'Alındı' → DISPATCHED", (await statusOf(shipmentId)) === ShipmentStatus.DISPATCHED);
    check("B4 toplar SHIPPED", (await rollState(rollIds[0])).status === RollStatus.SHIPPED);
    check("B5 shippedQty=30 (tek commit)", (await shippedQtyOf(lineId)) === 30);
  }

  // ── Senaryo C: unready commit'i geri alır ──
  console.log("\n--- C: Çuval depodan hazırlığa geri al (commit reverse) ---");
  await setFlag(false);
  {
    const { orderId, lineId, rollIds } = await setup([20, 25]); // 45m
    const shipmentId = await packShipment(orderId, rollIds);
    await ship.markReady(shipmentId);
    check("C1 commit: shippedQty=45", (await shippedQtyOf(lineId)) === 45);
    await ship.unmarkReady(shipmentId);
    check("C2 unready → PREPARING", (await statusOf(shipmentId)) === ShipmentStatus.PREPARING);
    check("C3 commit geri alındı: shippedQty=0", (await shippedQtyOf(lineId)) === 0);
    const rs = await Promise.all(rollIds.map(rollState));
    check("C4 toplar WAREHOUSE + shipmentId dolu (düzenlenebilir)", rs.every((r) => r.status === RollStatus.WAREHOUSE && r.shipmentId));
  }

  // ── Senaryo D: PREPARING'den direkt sevk (tek adım commit+SHIPPED) ──
  console.log("\n--- D: PREPARING'den direkt sevk (onay kapalı) ---");
  {
    const { orderId, lineId, rollIds } = await setup([60]);
    const shipmentId = await packShipment(orderId, rollIds);
    await ship.dispatchShipment(shipmentId, { plateNumber: "34 TEST 34" });
    check("D1 direkt dispatch → DISPATCHED", (await statusOf(shipmentId)) === ShipmentStatus.DISPATCHED);
    check("D2 commit yazıldı: shippedQty=60", (await shippedQtyOf(lineId)) === 60);
    check("D3 toplar SHIPPED", (await rollState(rollIds[0])).status === RollStatus.SHIPPED);
  }

  // ── Senaryo E: Fazla yükleme → GERÇEK okutulan gösterilir (kapsız), commit kapalı ──
  console.log("\n--- E: Fazla yükleme (okutulan 100 / istenen 50) ---");
  {
    const { orderId, lineId, rollIds } = await setup([100], 50); // satır 50, top 100
    const shipmentId = await packShipment(orderId, rollIds);
    const detail = (await ship.getShipmentById(shipmentId)) as {
      data: { orders: { lines: { lineId: string; requested: number; thisShipment: number; openQty: number }[] }[] };
    };
    const line = detail.data.orders[0].lines.find((l) => l.lineId === lineId)!;
    check("E1 okutulan GERÇEK gösteriliyor (100, kapsız değil 50)", Number(line.thisShipment) === 100, `thisShipment=${line.thisShipment}`);
    check("E2 istenen (openQty) = 50", Number(line.openQty) === 50, `openQty=${line.openQty}`);
    await ship.markReady(shipmentId);
    check("E3 commit KAPALI (shippedQty=50, over-credit yok)", (await shippedQtyOf(lineId)) === 50);

    // Eksik yükleme de doğru görünmeli.
    const u = await setup([30], 50); // satır 50, top 30
    const sid2 = await packShipment(u.orderId, u.rollIds);
    const det2 = (await ship.getShipmentById(sid2)) as {
      data: { orders: { lines: { lineId: string; thisShipment: number }[] }[] };
    };
    const l2 = det2.data.orders[0].lines.find((l) => l.lineId === u.lineId)!;
    check("E4 eksik yükleme okutulan=30 (gerçek)", Number(l2.thisShipment) === 30, `thisShipment=${l2.thisShipment}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup() {
  // FK sırası: movement/operation → roll → sack/allocation/order-link → shipment → orderLine → order.
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } }).catch(() => {});
  await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrders } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: createdOrders } } }).catch(() => {});
  await setFlag(false); // bayrağı default'a döndür
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
