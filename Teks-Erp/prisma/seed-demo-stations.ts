// =============================================================================
// DEMO — Tablet İstasyon Verisi (idempotent)
// =============================================================================
// Amaç: müşteri demosunda TABLETTEN her istasyonu gösterebilmek. Senaryo seed'i
// (seed-shipping-scenario.ts) zaten Tambur + Depo + Çuval/Paket + Sevkiyat +
// Sipariş ekranlarını dolduruyor. Bu script eksik istasyonları ekler:
//
//   • KK2 / Kurşun (PROCESS_QC): kart okut → sıraya düşen 2 açık kumaş topu
//   • Fason KABUL (SUBCONTRACTOR): boyahaneye sevk edilmiş, dönüş bekleyen 2 top
//   • KK1 (RAW_QC): giriş demosu için birkaç serbest STOK topu + aktif kart
//
// Ön koşul: `npm run seed` + `npm run seed:fixtures` (+ istenirse seed:scenario).
// Çalıştır:  npm run seed:demo   ·  npx tsx prisma/seed-demo-stations.ts
//
// Idempotent: DEMO- prefix'li kendi verisini önce siler, sonra kurar.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const P = "DEMO-"; // marker prefix — temizlik bu prefix'e göre çalışır
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function req<T>(v: T | null | undefined, label: string): T {
  if (!v) throw new Error(`Fixture eksik: ${label} (önce npm run seed + seed:fixtures)`);
  return v;
}

async function cleanup() {
  const wos = await prisma.workOrder.findMany({
    where: { workOrderNumber: { startsWith: P } },
    select: { id: true },
  });
  const woIds = wos.map((w) => w.id);
  const steps = await prisma.workOrderStep.findMany({
    where: { workOrderId: { in: woIds } },
    select: { id: true },
  });
  const stepIds = steps.map((s) => s.id);
  const rolls = await prisma.roll.findMany({
    where: {
      OR: [
        { currentStepId: { in: stepIds } },
        { producedInStepId: { in: stepIds } },
        { barcode: { startsWith: P } },
      ],
    },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  const dispatches = await prisma.subcontractorDispatch.findMany({
    where: { workOrderId: { in: woIds } },
    select: { id: true },
  });
  const dispatchIds = dispatches.map((d) => d.id);

  if (dispatchIds.length) {
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
  }
  if (rollIds.length) {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  }
  if (woIds.length) {
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  }
}

async function main() {
  console.log("🌱 DEMO — tablet istasyon verisi kuruluyor...\n");
  await cleanup();

  // --- Fixtures ---
  const patos = req(await prisma.item.findUnique({ where: { code: "PATOS" } }), "Ürün PATOS");
  const mavi = req(await prisma.color.findUnique({ where: { code: "MAVI" } }), "Renk MAVI");
  const grade1 = req(await prisma.qualityGrade.findUnique({ where: { code: "1.KALITE" } }), "1.KALITE");
  const pqStation = req(await prisma.station.findFirst({ where: { kind: "PROCESS_QC" } }), "KURSUN_KK2 (PROCESS_QC)");
  const fasonStation = req(await prisma.station.findFirst({ where: { kind: "SUBCONTRACTOR", code: "BOYA_FASON" } }), "BOYA_FASON");
  const boyer = req(await prisma.subcontractor.findFirst({ where: { code: "BOYER" } }), "Fason BOYER");
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const adminId = admin?.id ?? null;

  const baseRoll = {
    itemId: patos.id,
    colorId: mavi.id,
    width: 280,
    qualityGrade: grade1.code,
    qualityGradeId: grade1.id,
  };

  // ===========================================================================
  // 1) KK2 / KURŞUN (PROCESS_QC) — kart okut → 2 açık kumaş topu sırada
  // ===========================================================================
  const woKK2 = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${P}K-0001`,
      type: "ORDER_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: patos.id,
      targetColorId: mavi.id,
      width: 280,
      targetQuantity: 2000,
      steps: { create: [{ stationId: pqStation.id, stepSequence: 1 }] },
    },
    include: { steps: true },
  });
  const kk2Step = woKK2.steps[0];
  await prisma.travelerCard.create({
    data: {
      cardNumber: woKK2.workOrderNumber, barcode: woKK2.workOrderNumber,
      workOrderId: woKK2.id, status: "ACTIVE", version: 1, printedById: adminId,
    },
  });
  for (const qty of [1200, 800]) {
    const roll = await prisma.roll.create({
      data: {
        ...baseRoll, barcode: null, initialQty: qty, currentQty: qty,
        status: "IN_PRODUCTION", entrySource: "SUBCONTRACTOR_RETURN",
        currentStepId: kk2Step.id, producedInStepId: kk2Step.id, createdById: adminId,
      },
    });
    await prisma.rollMovement.create({
      data: { rollId: roll.id, workOrderStepId: kk2Step.id, qtyIn: qty, operatorId: adminId },
    });
  }
  console.log(`✅ KK2/Kurşun: kart ${woKK2.workOrderNumber} → 2 açık kumaş topu (1200m + 800m) sırada`);

  // ===========================================================================
  // 2) FASON KABUL (SUBCONTRACTOR) — boyahaneye sevk edilmiş, dönüş bekleyen 2 top
  // ===========================================================================
  const woFason = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${P}F-0001`,
      type: "ORDER_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: patos.id,
      targetColorId: mavi.id,
      width: 280,
      targetQuantity: 1000,
      steps: { create: [{ stationId: fasonStation.id, stepSequence: 1, plannedSubcontractorId: boyer.id }] },
    },
    include: { steps: true },
  });
  const fasonStep = woFason.steps[0];
  await prisma.travelerCard.create({
    data: {
      cardNumber: woFason.workOrderNumber, barcode: woFason.workOrderNumber,
      workOrderId: woFason.id, status: "ACTIVE", version: 1, printedById: adminId,
    },
  });
  // Parti (Batch) — SubcontractorDispatch.batchId NOT NULL (parti modeli).
  const batch = await prisma.batch.create({
    data: { batchNumber: `${P}P-0001`, workOrderId: woFason.id },
  });
  const dispatch = await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: `${P}SD-0001`, workOrderId: woFason.id, batchId: batch.id,
      stepId: fasonStep.id, subcontractorId: boyer.id, plannedSubcontractorId: boyer.id,
      dispatchedById: adminId, totalQty: 1000, plateNumber: "34 DMO 0001", driverName: "Demo Şoför",
    },
  });
  for (const qty of [600, 400]) {
    const roll = await prisma.roll.create({
      data: {
        ...baseRoll, colorId: null, barcode: `${P}FTOP-${qty}`, initialQty: qty, currentQty: qty,
        status: "AT_SUBCONTRACTOR", entrySource: "MANUAL_ENTRY",
        currentStepId: fasonStep.id, producedInStepId: fasonStep.id, createdById: adminId,
      },
    });
    await prisma.subcontractorDispatchItem.create({
      data: { dispatchId: dispatch.id, rollId: roll.id, dispatchedQty: qty },
    });
    await prisma.rollMovement.create({
      data: { rollId: roll.id, workOrderStepId: fasonStep.id, qtyIn: qty, operatorId: adminId },
    });
  }
  console.log(`✅ Fason kabul: sevk ${dispatch.dispatchNo} (kart ${woFason.workOrderNumber}) → 2 top (600m + 400m) boyahanede, dönüş bekliyor`);

  // ===========================================================================
  // 3) KK1 (RAW_QC) — giriş demosu için birkaç serbest STOK topu
  // ===========================================================================
  let kk1 = 0;
  for (const qty of [500, 350, 700]) {
    kk1++;
    await prisma.roll.create({
      data: {
        itemId: patos.id, width: 280, barcode: `${P}HAM-${String(kk1).padStart(4, "0")}`,
        initialQty: qty, currentQty: qty, status: "STOCK", entrySource: "MANUAL_ENTRY", createdById: adminId,
      },
    });
  }
  console.log(`✅ KK1: ${kk1} serbest STOK topu (ham mal giriş demosu)`);

  console.log("\n🎉 DEMO istasyon verisi tamamlandı. Tabletten tüm istasyonlar dolu.");
}

main()
  .catch((e) => {
    console.error("❌ Demo istasyon seed hatası:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
