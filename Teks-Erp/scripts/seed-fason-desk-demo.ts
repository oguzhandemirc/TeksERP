// Ekran testi için HAZIR demo iş emri: masaüstü fason sevki + fasondan fasona
// aktarım butonlarını gözle test etmek için. Veri SİLMEZ, ekler.
//
// Rota: [1] Zımpara (Fason, planlı KESTEL) → [2] Boyahane (Fason, planlı BOYER)
//       → [3] Tambur (internal). 3 stok topu Zımpara adımında BEKLER (sevke hazır).
//
// Çalıştır: npx tsx scripts/seed-fason-desk-demo.ts
import prisma from "../src/lib/prisma";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

const cards = new TravelerCardService();
const WIDTH = 250;

async function main(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  const ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "Station ZIMPARA_FASON");
  const ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  const ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "Station TAMBUR_1");
  const SUB_KESTEL = need(await prisma.subcontractor.findFirst({ where: { code: "KESTEL" }, select: { id: true } }), "Subcontractor KESTEL");
  const SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "Subcontractor BOYER");

  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `DEMO-FASON-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB_KESTEL },
          { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", plannedSubcontractorId: SUB_BOYER },
          { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  const zimparaStep = wo.steps[0].id;
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  // 3 top Zımpara adımında bekliyor (KK1 sonrası attach simülasyonu)
  for (let i = 1; i <= 3; i++) {
    const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
    await prisma.roll.create({
      data: {
        barcode: `DEMO-${stamp}-${rand}${i}`,
        itemId: ITEM,
        initialQty: 300,
        currentQty: 300,
        status: RollStatus.IN_PRODUCTION,
        currentStepId: zimparaStep,
        qualityGrade: "1.KALITE",
        qualityGradeId: GRADE,
        width: WIDTH,
        createdById: ADMIN,
      },
    });
  }

  console.log(`\n✅ Demo iş emri hazır: ${wo.batchNumber}`);
  console.log(`   Rota: Zımpara (KESTEL) → Boyahane (BOYER) → Tambur`);
  console.log(`   3 top (300 m) Zımpara adımında BEKLİYOR (sevke hazır).`);
  console.log(`\n   Electron'da İş Emirleri listesinde "${wo.batchNumber}" ara, aç, test et.\n`);
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
