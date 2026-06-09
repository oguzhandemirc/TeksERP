// Sevkiyat durum geçişleri eşzamanlılık (race) testi — markReady / moveToDoor /
// pullBackFromDoor / dispatch / cancel. Atomik claim ile çift-çalışma bozmamalı.
// Çalıştırma:  npx ts-node scripts/test_shipment_transition_races.ts
// Mevcut Customer + Item kullanır; ürettiği kayıtları sonunda temizler.
//
// Her geçiş için AYNI ANDA 2 çağrı → miktar-mutasyonu TAM BİR KEZ olmalı:
//   markReady : çift commit YOK (shippedQty 100, 200 değil)
//   moveToDoor: PREPARING'den çift commit YOK (shippedQty 100)
//   pullBack  : yan etkisiz, status READY
//   dispatch  : çift commit/çift stok-çıkışı YOK (shippedQty 100, toplar SHIPPED)
//   cancel    : çift tahsis-geri-alma YOK (shippedQty 0, -100 değil)
// Kaybeden eşzamanlı çağrı temiz 409 (veya seri çalışırsa idempotent) — asla bozulma.

import { RollStatus, ShipmentStatus, OrderStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

const ship = new ShippingService();
const CONFIRM_KEY = "shipping.confirmationEnabled";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const createdRolls: string[] = [];
const createdShipments: string[] = [];
const createdOrders: string[] = [];
const WIDTH = 150;
let itemId = "";
let customerId = "";

async function setFlag(on: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: CONFIRM_KEY },
    update: { value: on },
    create: { key: CONFIRM_KEY, value: on },
  });
}

async function setup(qtys: number[], lineQty = 1000): Promise<{ lineId: string; orderId: string; rollIds: string[] }> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-TRX-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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
        barcode: `TEST-TRX-WH-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
        itemId, colorId: null, width: WIDTH, initialQty: q, currentQty: q,
        status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE", entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      },
      select: { id: true },
    });
    rollIds.push(roll.id);
    createdRolls.push(roll.id);
  }
  return { lineId: order.lines[0].id, orderId: order.id, rollIds };
}

// PREPARING durumuna kadar getir (createShipment + çuval + okut + tart/kod).
async function packPreparing(orderId: string, rollIds: string[]): Promise<string> {
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

function tally(settled: PromiseSettledResult<unknown>[]) {
  const fulfilled = settled.filter((s) => s.status === "fulfilled").length;
  const rejected = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
  const ok409 = rejected.every((r) => r.reason?.statusCode === 409);
  return { fulfilled, rejectedN: rejected.length, ok409, raceHit: rejected.length === 1 };
}

async function main() {
  console.log("=== Sevkiyat Geçişleri Eşzamanlılık Testi ===\n");
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id; customerId = cust.id;
  await setFlag(false);

  // A) markReady — 2 eşzamanlı, çift commit YOK
  console.log("--- A) markReady race (çift commit YOK) ---");
  {
    const { lineId, orderId, rollIds } = await setup([60, 40]);
    const sid = await packPreparing(orderId, rollIds);
    const t = tally(await Promise.allSettled([ship.markReady(sid), ship.markReady(sid)]));
    check("A shippedQty=100 (200 DEĞİL — commit bir kez)", (await shippedQtyOf(lineId)) === 100);
    check("A status=READY", (await statusOf(sid)) === ShipmentStatus.READY);
    check("A ≤1 reddedilmiş + 409", t.rejectedN <= 1 && t.ok409, `f=${t.fulfilled} r=${t.rejectedN} raceHit=${t.raceHit}`);
  }

  // B) moveToDoor — PREPARING'den 2 eşzamanlı, çift commit YOK
  console.log("\n--- B) moveToDoor race (PREPARING'den çift commit YOK) ---");
  {
    const { lineId, orderId, rollIds } = await setup([55, 45]);
    const sid = await packPreparing(orderId, rollIds);
    const t = tally(await Promise.allSettled([ship.moveToDoor(sid), ship.moveToDoor(sid)]));
    check("B shippedQty=100 (commit bir kez)", (await shippedQtyOf(lineId)) === 100);
    check("B status=AT_DOOR", (await statusOf(sid)) === ShipmentStatus.AT_DOOR);
    check("B ≤1 reddedilmiş + 409", t.rejectedN <= 1 && t.ok409, `f=${t.fulfilled} r=${t.rejectedN} raceHit=${t.raceHit}`);
  }

  // C) pullBackFromDoor — AT_DOOR'dan 2 eşzamanlı, yan etkisiz
  console.log("\n--- C) pullBackFromDoor race (yan etkisiz) ---");
  {
    const { lineId, orderId, rollIds } = await setup([70, 30]);
    const sid = await packPreparing(orderId, rollIds);
    await ship.moveToDoor(sid); // → AT_DOOR (commit 100)
    const t = tally(await Promise.allSettled([ship.pullBackFromDoor(sid), ship.pullBackFromDoor(sid)]));
    check("C status=READY", (await statusOf(sid)) === ShipmentStatus.READY);
    check("C shippedQty=100 değişmedi", (await shippedQtyOf(lineId)) === 100);
    check("C ≤1 reddedilmiş + 409", t.rejectedN <= 1 && t.ok409, `f=${t.fulfilled} r=${t.rejectedN} raceHit=${t.raceHit}`);
  }

  // D) dispatch — PREPARING'den (flag kapalı) 2 eşzamanlı, çift commit/stok YOK
  console.log("\n--- D) dispatch race (çift commit + çift stok-çıkışı YOK) ---");
  {
    const { lineId, orderId, rollIds } = await setup([80, 20]);
    const sid = await packPreparing(orderId, rollIds);
    const t = tally(await Promise.allSettled([
      ship.dispatchShipment(sid, { plateNumber: "34TEST01" }),
      ship.dispatchShipment(sid, { plateNumber: "34TEST01" }),
    ]));
    check("D shippedQty=100 (commit bir kez)", (await shippedQtyOf(lineId)) === 100);
    check("D status=DISPATCHED", (await statusOf(sid)) === ShipmentStatus.DISPATCHED);
    const shippedRolls = await prisma.roll.count({ where: { id: { in: rollIds }, status: RollStatus.SHIPPED } });
    check("D tüm toplar SHIPPED", shippedRolls === rollIds.length, `${shippedRolls}/${rollIds.length}`);
    check("D ≤1 reddedilmiş + 409", t.rejectedN <= 1 && t.ok409, `f=${t.fulfilled} r=${t.rejectedN} raceHit=${t.raceHit}`);
  }

  // E) cancel — READY'den (tahsisli) 2 eşzamanlı, çift geri-alma YOK
  console.log("\n--- E) cancel race (çift tahsis-geri-alma YOK) ---");
  {
    const { lineId, orderId, rollIds } = await setup([90, 10]);
    const sid = await packPreparing(orderId, rollIds);
    await ship.markReady(sid); // → READY (commit 100 + tahsis)
    check("E ön-koşul shippedQty=100", (await shippedQtyOf(lineId)) === 100);
    const t = tally(await Promise.allSettled([ship.cancelShipment(sid), ship.cancelShipment(sid)]));
    check("E shippedQty=0 (reverse bir kez — NEGATİF YOK)", (await shippedQtyOf(lineId)) === 0, `sq=${await shippedQtyOf(lineId)}`);
    check("E status=CANCELLED", (await statusOf(sid)) === ShipmentStatus.CANCELLED);
    const freed = await prisma.roll.count({ where: { id: { in: rollIds }, shipmentId: null } });
    check("E toplar serbest (shipmentId null)", freed === rollIds.length, `${freed}/${rollIds.length}`);
    check("E ≤1 reddedilmiş + 409", t.rejectedN <= 1 && t.ok409, `f=${t.fulfilled} r=${t.rejectedN} raceHit=${t.raceHit}`);
  }

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
}

async function cleanup() {
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } }).catch(() => {});
  await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrders } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: createdOrders } } }).catch(() => {});
  await setFlag(false);
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => { console.error("Test hatası:", e); fail++; })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup hatası:", e));
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
