// Parti modeli DEMO seed — Electron "Partiler" panelini canlı görmek için.
//   Bir fason iş emri açar: 4 top → P1 (boyahane adımında) → 2 top boyahane fasonuna
//   sevk → K5 oto-böl → P1 (fasonda) + P2 (üretimde, boyahane adımında). P2 boyahane
//   adımında canlı olduğu için "Ayır" → REDYE_SAME_COLOR test edilebilir.
// TEMİZLİK YOK — veri kalır (smoke test için).
// Çalıştır: npx tsx scripts/seed-parti-demo.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { RollStatus } from "@prisma/client";

const WIDTH = 250;
const sub = new SubcontractorService();
const wos = new WorkOrderService();

async function main(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => {
    if (!v) throw new Error(`Seed eksik: ${l} — önce 'npm run seed' çalıştır.`);
    return v.id;
  };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE");
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  const ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  const CAT_BOYA = need(await prisma.subcontractorCategory.findFirst({ where: { code: "BOYA" }, select: { id: true } }), "BOYA");
  const SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "BOYER");
  const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } });

  const stamp = Date.now().toString().slice(-6);
  // Rota: [Boyahane fason (renk-veren, seq1) → Tambur (seq2)].
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `IE-DEMO-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "PLANNED",
      width: WIDTH,
      targetQuantity: 1200,
      targetItemId: ITEM,
      targetColorId: color?.id ?? null,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING", requiredCategoryId: CAT_BOYA, plannedSubcontractorId: SUB_BOYER },
          { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  const boyaStep = wo.steps[0].id;

  // 4 top oluştur → P1'e bağla (attach → parti + refakat kartı doğar).
  const bcs = [1, 2, 3, 4].map((i) => `DEMO-${stamp}-${i}`);
  for (const b of bcs) {
    await prisma.roll.create({
      data: {
        barcode: b, itemId: ITEM, initialQty: 300, currentQty: 300,
        status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE,
        width: WIDTH, createdById: ADMIN,
      },
    });
  }
  const attach = await wos.attachRolls(wo.id, bcs, ADMIN);
  const p1 = attach.data!.batch;
  const rolls = await prisma.roll.findMany({ where: { barcode: { in: bcs } }, select: { id: true, barcode: true } });
  const byBc = new Map(rolls.map((r) => [r.barcode, r.id]));

  // 2 top boyahane fasonuna sevk → K5 oto-böl (kalan 2 top → P2, splitFrom=P1).
  const res = await sub.bulkDispatchStep(
    { workOrderId: wo.id, stepId: boyaStep, rollIds: [byBc.get(bcs[0])!, byBc.get(bcs[1])!] },
    ADMIN,
  );
  const remainder = (res.data as { remainderBatch?: { batchNumber: string } }).remainderBatch;

  console.log(`\n✅ Parti demo iş emri hazır:\n`);
  console.log(`   İş Emri No                    : ${wo.workOrderNumber}`);
  console.log(`   P1 (fasonda, 2 top)           : ${p1?.batchNumber}`);
  console.log(`   P2 (üretimde/boyahanede, 2 top): ${remainder?.batchNumber}`);
  console.log(`\n   → Electron: İş Emirleri → "${wo.workOrderNumber}" aç → "Partiler" sekmesi.`);
  console.log(`   → P2'de "Ayır" → REDYE_SAME_COLOR çalışır (parti boyahane adımında canlı).`);
  console.log(`   → P1 fasonda: "Doğrudan Sevk" görünür; "Ayır" → UNDYED_MOVE "Yakında".\n`);
}

main()
  .catch((e) => { console.error("HATA:", e instanceof Error ? e.message : e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
