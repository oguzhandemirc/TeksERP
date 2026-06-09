// unmarkReady eşzamanlılık (race) testi — çift geri-alma shippedQty'yi NEGATİFE
// düşürmemeli. Çalıştırma:  npx ts-node scripts/test_unmark_ready_race.ts
// Mevcut Customer + Item kullanır; ürettiği Order/Roll/Shipment'ları sonunda temizler.
//
// Doğrulananlar:
//   1. READY sevkiyata AYNI ANDA 2 unmarkReady → reverseCommit yalnız BİR kez çalışır;
//      shippedQty 100→0 (çift düşüm/-100 YOK), tahsisler bir kez silinir, status PREPARING.
//      (Atomik claim olmadan: ikisi de düşer → shippedQty=-100, tahsis çift silinir.)
//   2. Kaybeden eşzamanlı çağrı temiz 409 (conflict) alır VEYA (seri çalışırsa)
//      idempotent "zaten hazırlanıyor" döner — ikisi de DOĞRU, asla bozulma yok.
//   3. SIRALI happy-path bozulmadı: unmarkReady READY→PREPARING (shippedQty düşer),
//      tekrar çağrı idempotent early-return (throw yok, shippedQty sabit).

import { RollStatus, ShipmentStatus, OrderStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

const ship = new ShippingService();

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

const WIDTH = 150;
let itemId = "";
let customerId = "";

async function setup(qtys: number[], lineQty = 1000): Promise<{ orderId: string; lineId: string; rollIds: string[] }> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-RACE-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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
        barcode: `TEST-RACE-WH-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
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

async function packAndReady(orderId: string, rollIds: string[]): Promise<string> {
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
  await ship.markReady(shipmentId); // PREPARING → READY (commit: shippedQty artar)
  return shipmentId;
}

const shippedQtyOf = async (lineId: string) =>
  Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);
const statusOf = async (shipmentId: string) =>
  (await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } }))!.status;
const allocCount = async (shipmentId: string) =>
  prisma.shipmentAllocation.count({ where: { shipmentId } });

async function main() {
  console.log("=== unmarkReady Eşzamanlılık Testi ===\n");
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id;
  customerId = cust.id;

  // ── 1) Eşzamanlı çift unmarkReady — 3 tur (race interleaving'i yakalama şansı) ──
  console.log("--- 1) READY sevkiyata 2 eşzamanlı unmarkReady ---");
  let raceHitCount = 0;
  for (let i = 1; i <= 3; i++) {
    const { lineId, rollIds } = await setup([60, 40]); // 100m
    const orderId = createdOrders[createdOrders.length - 1];
    const shipmentId = await packAndReady(orderId, rollIds);
    check(`tur${i} ön-koşul: shippedQty=100 (commit)`, (await shippedQtyOf(lineId)) === 100);

    const settled = await Promise.allSettled([ship.unmarkReady(shipmentId), ship.unmarkReady(shipmentId)]);
    const fulfilled = settled.filter((s) => s.status === "fulfilled").length;
    const rejected = settled.filter((s) => s.status === "rejected");
    if (rejected.length === 1) raceHitCount++;

    const sq = await shippedQtyOf(lineId);
    const alloc = await allocCount(shipmentId);
    const st = await statusOf(shipmentId);

    // ASIL İNVARYANT — bozulma yok:
    check(`tur${i} shippedQty=0 (çift düşüm YOK, negatif YOK)`, sq === 0, `sq=${sq}`);
    check(`tur${i} tahsis bir kez silindi (alloc=0)`, alloc === 0, `alloc=${alloc}`);
    check(`tur${i} status=PREPARING`, st === ShipmentStatus.PREPARING, st);
    check(`tur${i} en az 1 başarılı, en fazla 1 reddedilmiş`, fulfilled >= 1 && rejected.length <= 1,
      `fulfilled=${fulfilled} rejected=${rejected.length}`);
    if (rejected.length === 1) {
      const reason = (rejected[0] as PromiseRejectedResult).reason;
      check(`tur${i} kaybeden temiz 409 (conflict)`, reason?.statusCode === 409,
        `statusCode=${reason?.statusCode} msg=${reason?.message}`);
    }
  }
  console.log(`   (gerçek race interleaving yakalanan tur: ${raceHitCount}/3 — 0 olsa bile invaryant geçerli)`);

  // ── 2) SIRALI happy-path: bozulmadı + idempotent ──
  console.log("\n--- 2) Sıralı unmarkReady (happy-path + idempotent) ---");
  {
    const { lineId, rollIds } = await setup([70, 30]); // 100m
    const orderId = createdOrders[createdOrders.length - 1];
    const shipmentId = await packAndReady(orderId, rollIds);
    check("ön-koşul shippedQty=100", (await shippedQtyOf(lineId)) === 100);

    const r1 = (await ship.unmarkReady(shipmentId)) as { success: boolean };
    check("1. unmarkReady başarılı → PREPARING", r1.success && (await statusOf(shipmentId)) === ShipmentStatus.PREPARING);
    check("commit geri alındı shippedQty=0", (await shippedQtyOf(lineId)) === 0);

    // İkinci (sıralı) çağrı: status zaten PREPARING → idempotent early-return, THROW YOK
    let threw = false;
    let r2msg = "";
    try {
      const r2 = (await ship.unmarkReady(shipmentId)) as { message?: string };
      r2msg = r2.message ?? "";
    } catch {
      threw = true;
    }
    check("2. (tekrar) unmarkReady throw ETMEDİ (idempotent early-return)", !threw, r2msg);
    check("idempotent çağrı shippedQty'yi BOZMADI (hâlâ 0)", (await shippedQtyOf(lineId)) === 0);
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
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => {
    console.error("Test hatası:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup hatası:", e));
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
