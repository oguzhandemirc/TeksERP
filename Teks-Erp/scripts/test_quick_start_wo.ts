// Mobil "Hızlı İş Emri" (quickStart) backend davranış testi.
// Çalıştırma:  npx ts-node scripts/test_quick_start_wo.ts
// Test verisi üzerinde çalışır; ürettiği roll/WO kayıtlarını sonunda temizler.
//
// Doğrulananlar:
//   1. Basit akış: 3 STOCK top okut → WO oluşur, targetItem topraklardan türetilir,
//      toplar IN_PRODUCTION + ilk adıma bağlanır, attached=3.
//   2. Karışık ürün reddi (tek WO = tek kumaş) — ve WO ORPHAN bırakılmaz.
//   3. STOCK olmayan top reddi — WO orphan bırakılmaz.
//   4. Bulunamayan barkod reddi — WO orphan bırakılmaz.
//   5. targetItem uyuşmazlığı reddi.
//   6. Sipariş bağlama: orderLineIds verilince type=ORDER_PRODUCTION + bağ kurulur.

import { RollStatus, RollEntrySource, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { computeWoMaterial } from "../src/services/helpers/coverage.helper";

const svc = new WorkOrderService();

const createdRollIds: string[] = [];
const createdWoIds: string[] = [];
const createdOrderIds: string[] = [];
const createdCustomerIds: string[] = [];

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

async function makeStockRoll(itemId: string, qty: number, status: RollStatus = RollStatus.STOCK) {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-QS-${Date.now()}-${Math.floor(Math.random() * 1e7)}`,
      itemId,
      colorId: null, // ham (renksiz)
      width: 150,
      initialQty: qty,
      currentQty: qty,
      status,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, barcode: true, itemId: true },
  });
  createdRollIds.push(roll.id);
  return { ...roll, barcode: roll.barcode as string };
}

async function expectReject(label: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    check(label, false, "beklenen hata atılmadı");
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, true, msg.slice(0, 80));
    return msg;
  }
}

async function woCountForBatch(batchNumber: string): Promise<number> {
  return prisma.workOrder.count({ where: { batchNumber } });
}

async function main() {
  console.log("=== Hızlı İş Emri (quickStart) Testi ===\n");

  // --- Fixtures ---
  const itemA = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const itemB = await prisma.item.findFirst({
    where: { isActive: true, id: { not: itemA?.id } },
    select: { id: true },
  });
  const station = await prisma.station.findFirst({
    where: { allowAsWorkOrderStep: true },
    select: { id: true, type: true },
  });
  if (!itemA || !station) {
    throw new Error("Test verisi yetersiz — aktif Item + WO-step istasyonu yok (önce npm run seed).");
  }
  const steps = [{ stationId: station.id, notes: null }];

  // ===========================================================================
  // 1. Basit akış: 3 STOCK top, targetItem verilmedi → topraklardan türetilir
  // ===========================================================================
  const r1 = await makeStockRoll(itemA.id, 100);
  const r2 = await makeStockRoll(itemA.id, 100);
  const r3 = await makeStockRoll(itemA.id, 100);

  const res = await svc.quickStart(
    { steps, rollBarcodes: [r1.barcode, r2.barcode, r3.barcode] },
    undefined,
  );
  if (res.data?.workOrder) createdWoIds.push(res.data.workOrder.id);

  check("Basit: quickStart success", res.success === true);
  check("Basit: attached=3", res.data?.attached === 3, `attached=${res.data?.attached}`);
  check("Basit: 0 hata", (res.data?.errors.length ?? -1) === 0, `errors=${JSON.stringify(res.data?.errors)}`);
  check(
    "Basit: targetItem topraklardan türetildi",
    res.data?.workOrder.targetItemId === itemA.id,
    `targetItemId=${res.data?.workOrder.targetItemId}`,
  );
  check(
    "Basit: type STOCK_PRODUCTION (sipariş yok)",
    res.data?.workOrder.type === "STOCK_PRODUCTION",
    `type=${res.data?.workOrder.type}`,
  );

  const boundRolls = await prisma.roll.findMany({
    where: { id: { in: [r1.id, r2.id, r3.id] } },
    select: { id: true, status: true, currentStepId: true, producedInStepId: true },
  });
  check(
    "Basit: toplar IN_PRODUCTION",
    boundRolls.every((r) => r.status === RollStatus.IN_PRODUCTION),
    boundRolls.map((r) => r.status).join(","),
  );
  const woSteps = await prisma.workOrderStep.findMany({
    where: { workOrderId: res.data!.workOrder.id },
    orderBy: { stepSequence: "asc" },
    select: { id: true },
  });
  const firstStepId = woSteps[0]?.id;
  check(
    "Basit: toplar ilk adıma bağlandı (currentStepId)",
    boundRolls.every((r) => r.currentStepId === firstStepId),
  );

  // Refakat kartı oluştu mu?
  const cardCount = await prisma.travelerCard.count({ where: { workOrderId: res.data!.workOrder.id } });
  check("Basit: refakat kartı oluştu", cardCount >= 1, `kart=${cardCount}`);

  // "Üretime giren" (committed) attach anında dolu olmalı — ilk adım INTERNAL ise
  // movement'la, EXTERNAL ise currentStepId=ilk adım (B-set) ile. 3×100 = 300.
  const woMat = await computeWoMaterial(prisma, [res.data!.workOrder.id]);
  check(
    "Basit: committed (üretime giren) attach anında 300",
    Number(woMat.get(res.data!.workOrder.id)?.committed ?? 0) === 300,
    `committed=${Number(woMat.get(res.data!.workOrder.id)?.committed ?? 0)}`,
  );

  // ===========================================================================
  // 2. Karışık ürün reddi + orphan WO bırakılmaması
  // ===========================================================================
  if (itemB) {
    const m1 = await makeStockRoll(itemA.id, 50);
    const m2 = await makeStockRoll(itemB.id, 50);
    const before = await prisma.workOrder.count();
    await expectReject("Karışık ürün reddedildi", () =>
      svc.quickStart({ steps, rollBarcodes: [m1.barcode, m2.barcode] }, undefined),
    );
    const after = await prisma.workOrder.count();
    check("Karışık ürün: orphan WO yaratılmadı", before === after, `before=${before} after=${after}`);
  } else {
    console.log("ℹ️  İkinci ürün yok — karışık-ürün testi atlandı.");
  }

  // ===========================================================================
  // 3. STOCK olmayan top reddi
  // ===========================================================================
  const wh = await makeStockRoll(itemA.id, 50, RollStatus.WAREHOUSE);
  const beforeWh = await prisma.workOrder.count();
  await expectReject("STOCK olmayan top reddedildi", () =>
    svc.quickStart({ steps, rollBarcodes: [wh.barcode] }, undefined),
  );
  const afterWh = await prisma.workOrder.count();
  check("STOCK olmayan: orphan WO yok", beforeWh === afterWh);

  // ===========================================================================
  // 4. Bulunamayan barkod reddi
  // ===========================================================================
  await expectReject("Bulunamayan barkod reddedildi", () =>
    svc.quickStart({ steps, rollBarcodes: ["YOK-BARKOD-123456"] }, undefined),
  );

  // ===========================================================================
  // 5. targetItem uyuşmazlığı reddi
  // ===========================================================================
  if (itemB) {
    const x1 = await makeStockRoll(itemA.id, 50);
    await expectReject("targetItem uyuşmazlığı reddedildi", () =>
      svc.quickStart(
        { steps, targetItemId: itemB.id, rollBarcodes: [x1.barcode] },
        undefined,
      ),
    );
  }

  // ===========================================================================
  // 6. Sipariş bağlama: orderLineIds → ORDER_PRODUCTION
  // ===========================================================================
  // Renksiz bir sipariş kalemi fixture'ı kur (renkli kalem create()'in renk-rota
  // kuralına takılır; o kural create()'in işi ve başka testlerde kanıtlı). Burada
  // amaç: quickStart'ın orderLineIds'i ORDER_PRODUCTION olarak bağladığını görmek.
  const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const customer = await prisma.customer.create({
    data: { code: `TST-${uniq}`.slice(0, 32), name: "QuickStart Test Müşteri" },
    select: { id: true },
  });
  createdCustomerIds.push(customer.id);
  const order = await prisma.order.create({
    data: {
      orderNumber: `QS-ORD-${uniq}`,
      customerId: customer.id,
      lines: { create: [{ itemId: itemA.id, colorId: null, quantity: 200, width: 150 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  createdOrderIds.push(order.id);
  const lineId = order.lines[0].id;

  const o1 = await makeStockRoll(itemA.id, 80);
  const ores = await svc.quickStart(
    { steps, orderLineIds: [lineId], rollBarcodes: [o1.barcode] },
    undefined,
  );
  if (ores.data?.workOrder) createdWoIds.push(ores.data.workOrder.id);
  check(
    "Sipariş bağlama: type ORDER_PRODUCTION (orderLineIds'ten türetildi)",
    ores.data?.workOrder.type === "ORDER_PRODUCTION",
    `type=${ores.data?.workOrder.type}`,
  );
  check("Sipariş bağlama: attached=1", ores.data?.attached === 1, `attached=${ores.data?.attached}`);
  const linkCount = await prisma.workOrderToOrderLine.count({
    where: { workOrderId: ores.data!.workOrder.id, orderLineId: lineId },
  });
  check("Sipariş bağlama: WO↔OrderLine bağı kuruldu", linkCount === 1, `link=${linkCount}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} kaldı ===`);
}

async function cleanup() {
  console.log("\n🧹 Temizlik...");
  // Bağlanan WO'ları arşivlemeden direkt fiziksel temizle (test verisi).
  // Sıra: rollMovement → roll → travelerCard → workOrderStep → workOrder.
  if (createdRollIds.length > 0) {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRollIds } } });
  }
  for (const woId of createdWoIds) {
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: woId } } }).catch(() => undefined);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrder.delete({ where: { id: woId } }).catch(() => undefined);
  }
  // Order/Customer fixture (lines onDelete:Cascade ile gider).
  for (const orderId of createdOrderIds) {
    await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
  }
  for (const customerId of createdCustomerIds) {
    await prisma.customer.delete({ where: { id: customerId } }).catch(() => undefined);
  }
  console.log("🧹 Temizlik tamam.");
}

main()
  .catch((e) => {
    console.error("TEST HATASI:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Temizlik hatası:", e));
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
