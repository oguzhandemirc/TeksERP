// Çuval Depo geri çekme + çuvaldan çuvala okutma testi.
// Çalıştırma:  npx ts-node scripts/test_sack_move_pullback.ts
// Mevcut Customer + Item kullanır; ürettiği Order/Roll/Swatch/Shipment'ları sonunda temizler.
//
// Kapsam (kullanıcı soruları + bulgu avı):
//   A. Çuvaldan çuvala okutma: re-scan = taşı (çift kayıt yok), idempotent, sevkiyatlar arası red.
//   B. Çuval Depo (READY) davranışı (saha #3 sonrası YENİ sözleşme): okutma + çuval silme
//      hâlâ reddedilir; top çıkarma ÇALIŞIR (recommit + boşalan çuval silinir) ve
//      tartı/kod güncelleme ÇALIŞIR (içerik düzeltmesi sonrası yeniden tartı yolu).
//   C. Geri çekme zinciri: AT_DOOR→READY (pull-back), READY→PREPARING (unready, commit geri),
//      top sevkiyattan çıkarma → serbest depo → başka sevkiyata okutulabilir; dolu çuval silme.
//   D. Sertleştirme doğrulamaları (2026-06-10 denetiminde bulunan 5 bulgunun fix'leri):
//      D1 boş çuval (tartılı+kodlu olsa da) Sevke Hazır'ı BLOKLAR (hayalet çuval yok)
//      D2 tartı sonrası içerik değişiminde weightKg SIFIRLANIR (yeniden tartı zorunlu)
//      D3 iptal edilmiş kartela (cancelledAt dolu) okutulamaz (soft-delete giriş guard'ı)
//      D4 kartela eşzamanlı okutmada atomik claim: tam 1 kazanan (top ile aynı desen)
//      D5 AT_DOOR'daki sevkiyatın topu iptal edilemez (guard PREPARING/READY/AT_DOOR)

import { RollStatus, ShipmentStatus, OrderStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";

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

async function expectErr(label: string, msgPart: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "hata bekleniyordu ama başarılı oldu");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(label, m.includes(msgPart), m);
  }
}

const createdRolls: string[] = [];
const createdSwatches: string[] = [];
const createdShipments: string[] = [];
const createdOrders: string[] = [];

let WIDTH = 150;
let itemId = "";
let customerId = "";

async function makeOrder(lineQty = 1000): Promise<{ orderId: string; lineId: string }> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-SACK-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
      status: OrderStatus.APPROVED,
      lines: { create: [{ itemId, colorId: null, width: WIDTH, quantity: lineQty }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  createdOrders.push(order.id);
  return { orderId: order.id, lineId: order.lines[0].id };
}

async function makeRoll(qty: number): Promise<{ id: string; barcode: string }> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-SK-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      itemId,
      colorId: null,
      width: WIDTH,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, barcode: true },
  });
  createdRolls.push(roll.id);
  return { id: roll.id, barcode: roll.barcode! };
}

async function makeSwatch(cancelled = false): Promise<{ id: string; barcode: string }> {
  const n = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const sw = await prisma.swatch.create({
    data: {
      cardNumber: `TEST-SWC-${n}`,
      barcode: `TEST-SWB-${n}`,
      itemId,
      ...(cancelled ? { cancelledAt: new Date(), cancelReason: "TEST iptal" } : {}),
    },
    select: { id: true, barcode: true },
  });
  createdSwatches.push(sw.id);
  return sw;
}

async function makeShipment(orderId: string): Promise<string> {
  // Saha #19: bu test çuval tartısı zorunluluğunu (B0b vb.) varsayıyor → EXPORT
  // sevkiyat kullan (yurtiçi sevkte tartı zorunlu değildir; ayrı testte ele alınır).
  const created = (await ship.createShipment({ orderIds: [orderId], destination: "EXPORT" })) as {
    data: { id: string };
  };
  createdShipments.push(created.data.id);
  return created.data.id;
}

async function makeSack(shipmentId: string): Promise<string> {
  const res = (await ship.addSack({ shipmentId })) as { data: { id: string } };
  return res.data.id;
}

const rollState = async (id: string) =>
  (await prisma.roll.findUnique({
    where: { id },
    select: { status: true, shipmentId: true, sackId: true },
  }))!;
const statusOf = async (shipmentId: string) =>
  (await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } }))!.status;
const shippedQtyOf = async (lineId: string) =>
  Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);
const sackRollCount = async (sackId: string) => prisma.roll.count({ where: { sackId } });

async function main() {
  console.log("=== Çuval Depo Geri Çekme + Çuvaldan Çuvala Okutma Testi ===");
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id;
  customerId = cust.id;

  // Ortak kurulum: order1+ship1 (sack1, sack2), order2+ship2 (sackB, r3 içinde)
  const { orderId: order1, lineId: line1 } = await makeOrder();
  const { orderId: order2 } = await makeOrder();
  const ship1 = await makeShipment(order1);
  const ship2 = await makeShipment(order2);
  const sack1 = await makeSack(ship1);
  const sack2 = await makeSack(ship1);
  const sackB = await makeSack(ship2);
  const r1 = await makeRoll(40);
  const r2 = await makeRoll(25);
  const r3 = await makeRoll(30);
  await ship.scanIntoShipment({ shipmentId: ship2, barcode: r3.barcode, sackId: sackB });

  // ── A: Çuvaldan çuvala okutma ──
  console.log("\n--- A: Çuvaldan çuvala okutma (re-scan = taşı) ---");
  const a1 = (await ship.scanIntoShipment({ shipmentId: ship1, barcode: r1.barcode, sackId: sack1 })) as {
    message?: string;
  };
  check("A1 top çuval-1'e okutuldu", (await rollState(r1.id)).sackId === sack1, a1.message);

  const a2 = (await ship.scanIntoShipment({ shipmentId: ship1, barcode: r1.barcode, sackId: sack2 })) as {
    message?: string;
  };
  const r1s = await rollState(r1.id);
  check("A2 re-scan çuval-2 → taşındı (mesaj)", a2.message === "Top bu çuvala taşındı", a2.message);
  check("A2b top artık çuval-2'de", r1s.sackId === sack2);
  check("A2c çuval-1 boşaldı (çift kayıt yok)", (await sackRollCount(sack1)) === 0);

  const a3 = (await ship.scanIntoShipment({ shipmentId: ship1, barcode: r1.barcode, sackId: sack2 })) as {
    message?: string;
  };
  check("A3 aynı çuvala re-scan idempotent", a3.message === "Top zaten bu çuvalda", a3.message);

  await expectErr("A4 başka sevkiyattaki top reddedilir", "Top başka bir sevkiyatta", () =>
    ship.scanIntoShipment({ shipmentId: ship1, barcode: r3.barcode, sackId: sack1 })
  );
  await expectErr("A5 başka sevkiyatın çuvalı reddedilir", "Çuval bu sevkiyata ait değil", () =>
    ship.scanIntoShipment({ shipmentId: ship1, barcode: r1.barcode, sackId: sackB })
  );

  // r2'yi çuvalsız okut (loose) → invariant testi + moveRollToSack
  await ship.scanIntoShipment({ shipmentId: ship1, barcode: r2.barcode, sackId: null });
  await expectErr("B0 çuvalsız top Sevke Hazır'ı bloklar", "henüz bir çuvalda değil", () =>
    ship.markReady(ship1)
  );
  const a6 = (await ship.moveRollToSack({ rollId: r2.id, sackId: sack1 })) as { message?: string };
  check("A6 moveRollToSack (listeden taşıma)", (await rollState(r2.id)).sackId === sack1, a6.message);

  // ── B: Çuval Depo (READY) kilitleri ──
  console.log("\n--- B: Çuval Depo'ya kaldırınca kilitler ---");
  await expectErr("B0b tartısız çuval bloklar", "tartısı girilmemiş", () => ship.markReady(ship1));
  await ship.updateSack({ sackId: sack1, weightKg: 42, manualCode: "TEST-K1" });
  await ship.updateSack({ sackId: sack2, weightKg: 38, manualCode: "TEST-K2" });
  await ship.markReady(ship1);
  check("B1 markReady → READY (çuval depo)", (await statusOf(ship1)) === ShipmentStatus.READY);
  check("B1b commit yazıldı (shippedQty=65)", (await shippedQtyOf(line1)) === 65);

  await expectErr("B2 READY'de okutma reddedilir", "Yalnızca hazırlanan sevkiyata", () =>
    ship.scanIntoShipment({ shipmentId: ship1, barcode: r1.barcode, sackId: sack1 })
  );
  // Saha #3 YENİ sözleşme: READY'de top çıkarma ÇALIŞIR — recommit (65→40, r2=25
  // düştü) + içeriği değişen çuvalın tartısı sıfır + boşalan çuval otomatik silinir.
  await ship.removeRollFromShipment({ shipmentId: ship1, rollId: r2.id });
  check("B3 READY'de top çıkarma çalışır + recommit (65→40)", (await shippedQtyOf(line1)) === 40);
  const r2AfterB3 = await rollState(r2.id);
  check(
    "B3b çıkan top serbest depoya döndü",
    r2AfterB3.status === RollStatus.WAREHOUSE && r2AfterB3.shipmentId === null && r2AfterB3.sackId === null
  );
  check(
    "B4 boşalan çuval READY'de otomatik silindi",
    (await prisma.sack.findUnique({ where: { id: sack1 } })) === null
  );
  // Saha #3: tartı/kod güncelleme READY'de ÇALIŞIR (içerik düzeltmesi tartıyı
  // sıfırlayınca yeniden tartı bu yoldan girilir — unready'siz akış).
  await ship.updateSack({ sackId: sack2, weightKg: 50, manualCode: "TEST-K2" });
  const sack2W = await prisma.sack.findUnique({ where: { id: sack2 }, select: { weightKg: true } });
  check("B5 READY'de tartı/kod güncelleme çalışır (yeniden tartı yolu)", Number(sack2W?.weightKg) === 50);
  await expectErr("B6 READY'de çuval silme reddedilir", "silinemez", () => ship.removeSack(sack2));

  // ── C: Geri çekme zinciri ──
  console.log("\n--- C: Kapı önünden / çuval depodan geri çekme ---");
  await ship.moveToDoor(ship1);
  check("C1 kapı önüne kondu (AT_DOOR)", (await statusOf(ship1)) === ShipmentStatus.AT_DOOR);
  check("C1b çift commit yok (40)", (await shippedQtyOf(line1)) === 40);
  await ship.pullBackFromDoor(ship1);
  check("C2 kapı önünden geri çekildi (READY)", (await statusOf(ship1)) === ShipmentStatus.READY);
  check("C2b commit korundu (40)", (await shippedQtyOf(line1)) === 40);

  await ship.unmarkReady(ship1);
  check("C3 hazırlığa geri alındı (PREPARING)", (await statusOf(ship1)) === ShipmentStatus.PREPARING);
  check("C3b commit geri alındı (0)", (await shippedQtyOf(line1)) === 0);
  const r1AfterUnready = await rollState(r1.id);
  check(
    "C3c top hâlâ çuvalda + WAREHOUSE (düzenlenebilir)",
    r1AfterUnready.status === RollStatus.WAREHOUSE && r1AfterUnready.shipmentId === ship1 && r1AfterUnready.sackId === sack2
  );

  // r2 B3'te READY'deyken çıkarılmıştı — hâlâ serbest depoda olmalı.
  const r2Free = await rollState(r2.id);
  check(
    "C4 top sevkiyattan çıktı → serbest depo",
    r2Free.status === RollStatus.WAREHOUSE && r2Free.shipmentId === null && r2Free.sackId === null
  );
  const c5 = (await ship.scanIntoShipment({ shipmentId: ship2, barcode: r2.barcode, sackId: sackB })) as {
    message?: string;
  };
  check("C5 serbest kalan top BAŞKA sevkiyata okutulabilir", (await rollState(r2.id)).shipmentId === ship2, c5.message);

  await expectErr("C6 dolu çuval içeriksiz silinemez", "Dolu çuval silinemez", () => ship.removeSack(sack2));
  const c7 = (await ship.removeSack(sack2, undefined, true)) as { message?: string };
  const r1Freed = await rollState(r1.id);
  check(
    "C7 çuval içeriğiyle silindi → top depoya döndü",
    r1Freed.shipmentId === null && r1Freed.sackId === null && r1Freed.status === RollStatus.WAREHOUSE,
    c7.message
  );

  // ── D: Sertleştirme doğrulamaları ──
  console.log("\n--- D: Sertleştirme doğrulamaları ---");

  // D1: boş çuval (tartılı+kodlu olsa da) Sevke Hazır'ı bloklar (hayalet çuval yok)
  // sack1 B3'te otomatik silindi, sack2 C7'de içeriğiyle silindi → r1 için taze çuval aç.
  const sackD = await makeSack(ship1);
  await ship.scanIntoShipment({ shipmentId: ship1, barcode: r1.barcode, sackId: sackD }); // r1 geri ship1'e
  const sack3 = await makeSack(ship1); // boş kalacak
  await ship.updateSack({ sackId: sack3, weightKg: 7, manualCode: "TEST-BOS" });
  await expectErr("D1 boş çuval Sevke Hazır'ı bloklar (hayalet çuval irsaliyeye giremez)", "çuvallar boş", () =>
    ship.markReady(ship1)
  );
  await ship.removeSack(sack3); // boş çuvalı temizle

  // D2: tartı sonrası içerik değişimi → İKİ çuvalın da tartısı sıfırlanır (yeniden tartı zorunlu)
  await ship.updateSack({ sackId: sackD, weightKg: 42, manualCode: "TEST-K1" });
  const sack4 = await makeSack(ship1);
  await ship.updateSack({ sackId: sack4, weightKg: 9, manualCode: "TEST-K4" });
  await ship.moveRollToSack({ rollId: r1.id, sackId: sack4 }); // sackD→sack4: ikisinin de içeriği değişti
  const sackDW = await prisma.sack.findUnique({ where: { id: sackD }, select: { weightKg: true } });
  const sack4W = await prisma.sack.findUnique({ where: { id: sack4 }, select: { weightKg: true } });
  check(
    "D2 içerik değişince iki çuvalın da tartısı sıfırlanır (bayat kg irsaliyeye gidemez)",
    sackDW?.weightKg === null && sack4W?.weightKg === null,
    `çuval-D: ${sackDW?.weightKg ?? "null"}, çuval-4: ${sack4W?.weightKg ?? "null"}`
  );

  // D3: iptal edilmiş kartela okutulamaz (soft-delete giriş guard'ı)
  const swCancelled = await makeSwatch(true);
  await expectErr("D3 iptal edilmiş kartela okutulamaz", "İptal edilmiş kartela okutulamaz", () =>
    ship.scanIntoShipment({ shipmentId: ship1, barcode: swCancelled.barcode, sackId: sack4 })
  );

  // D4: kartela eşzamanlı okutmada atomik claim — tam 1 kazanan (top ile aynı desen)
  const { orderId: order3 } = await makeOrder();
  const ship3 = await makeShipment(order3);
  const sw2 = await makeSwatch(false);
  let swatchRaceOk = true;
  let lastDetail = "";
  for (let i = 0; i < 3; i++) {
    await prisma.swatch.update({ where: { id: sw2.id }, data: { shipmentId: null, sackId: null } });
    const results = await Promise.allSettled([
      ship.scanIntoShipment({ shipmentId: ship1, barcode: sw2.barcode, sackId: null }),
      ship.scanIntoShipment({ shipmentId: ship3, barcode: sw2.barcode, sackId: null }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    lastDetail = `deneme ${i + 1}: ${ok}/2 başarılı`;
    if (ok !== 1) {
      swatchRaceOk = false;
      break;
    }
  }
  check(
    "D4 kartela eşzamanlı okutmada atomik claim (tam 1 kazanan, kaybeden temiz 409)",
    swatchRaceOk,
    lastDetail
  );

  // D4b pozitif kontrol: TOP'ta atomik claim çalışıyor (tam 1 kazanan)
  const r4 = await makeRoll(10);
  let rollRaceOk = true;
  for (let i = 0; i < 3; i++) {
    await prisma.roll.update({
      where: { id: r4.id },
      data: { shipmentId: null, sackId: null, status: RollStatus.WAREHOUSE },
    });
    const results = await Promise.allSettled([
      ship.scanIntoShipment({ shipmentId: ship1, barcode: r4.barcode, sackId: null }),
      ship.scanIntoShipment({ shipmentId: ship3, barcode: r4.barcode, sackId: null }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok !== 1) {
      rollRaceOk = false;
      break;
    }
  }
  check("D4b kontrol: TOP'ta atomik claim doğru (eşzamanlı okutmada tam 1 kazanan)", rollRaceOk);

  // D5: AT_DOOR'daki sevkiyatın topu iptal edilemez (guard PREPARING/READY/AT_DOOR)
  // ship2: r2+r3 sackB'de — tartı+kod gir, kapı önüne koy.
  await ship.updateSack({ sackId: sackB, weightKg: 30, manualCode: "TEST-KB" });
  const { lineId: line2 } = { lineId: (await prisma.orderLine.findFirst({ where: { orderId: order2 }, select: { id: true } }))!.id };
  await ship.moveToDoor(ship2); // PREPARING → AT_DOOR (commit burada)
  check("D5 hazırlık: ship2 kapı önünde", (await statusOf(ship2)) === ShipmentStatus.AT_DOOR);
  const committedQty = await shippedQtyOf(line2);
  check("D5 hazırlık: commit yazıldı (55)", committedQty === 55, `shippedQty=${committedQty}`);

  await expectErr("D5 KAPI ÖNÜNDEKİ (AT_DOOR) sevkiyatın topu iptal edilemez", "önce sevkten çıkarın", () =>
    inv.softDelete(r3.id)
  );
  const r3State = await rollState(r3.id);
  check("D5b top iptal OLMADI (hâlâ WAREHOUSE + sevkiyatta)", r3State.status === RollStatus.WAREHOUSE && r3State.shipmentId === ship2);
  check("D5c karşılanma bozulmadı (55)", (await shippedQtyOf(line2)) === 55);

  // Pozitif kontrol: READY'de de aynı iptal bloklanıyor + cancel-preview aynı dili konuşuyor
  await ship.pullBackFromDoor(ship2); // AT_DOOR → READY
  await expectErr("D5d kontrol: ÇUVAL DEPODAKİ (READY) sevkiyatın topu iptal edilemiyor", "önce sevkten çıkarın", () =>
    inv.softDelete(r2.id)
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup() {
  // FK sırası: movement/operation → roll/swatch → sack/allocation/order-link → shipment → orderLine → order.
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(() => {});
  await prisma.swatch.deleteMany({ where: { id: { in: createdSwatches } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipmentAllocation.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipments } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } }).catch(() => {});
  await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrders } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: createdOrders } } }).catch(() => {});
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
