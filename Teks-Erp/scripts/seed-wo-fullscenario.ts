// Kapsamlı test verisi: TEK iş emrinde tüm fonksiyonları test edebileceğin
// senaryo. Aynı spec'li (PATOS / Lacivert / 250cm) toplar FARKLI zamanlarda
// işleme girmiş; kimi KK1'de, kimi boyahanede (fasonda), kimi Kurşun'da, kimi
// Tambur'da, kimi depoda. 4 farklı fason dalı (açık / Kurşun / Tambur / Depo).
//
// NOT: currentStepId/producedInStepId ve dispatch/receive stepId hepsi WorkOrderStep
// id'sidir (Station değil). ST = Station id (adım yaratma + eşleştirme); WS = bu
// WO'nun WorkOrderStep id'leri (yarattıktan sonra doldurulur).
//
// Çalıştır: npx ts-node scripts/seed-wo-fullscenario.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { RollStatus } from "@prisma/client";

const ST = {
  KK1: "c9c0b292-0d6d-4a09-b121-e1f4a376b489",
  BOYA: "9254a500-68ff-4b88-af15-0e3182e3b14e",
  KURSUN: "3013fb17-ab57-4ffa-ac8e-82b9f309d899",
  TAMBUR: "42270197-9e09-4984-a80f-703df2beec2e",
};
const ITEM = "9d49919d-b1d7-4e06-bb68-f55c5fb09911"; // PATOS
const COLOR = "46e2bdfb-18e5-428a-9d93-ea872dffa425"; // Lacivert
const GRADE = "a1b5b3e1-e899-4ac3-9d57-b329491056b1"; // 1.KALITE
const BOYA_CAT = "5b774386-45f4-4905-8044-88fe0d5b21dc"; // Boyahane
const SUB = "f83bcbf5-1f59-4eef-953d-fd4526c5c070"; // Boyer Boyacılık
const ADMIN = "ff0baa78-8a0f-469e-8f1a-437efb3d4499";
const WIDTH = 250;

// Bu WO'nun WorkOrderStep id'leri (yarattıktan sonra doldurulur).
const WS = { kk1: "", boya: "", kursun: "", tambur: "" };

const sub = new SubcontractorService();
const cards = new TravelerCardService();

let bc = 0;
function barcode(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TEKS-${ymd}-${rand}${bc}`;
}

/** Rotada belirli bir adımda (WorkOrderStep) duran top — açık RollMovement ile. */
async function placeRoll(opts: {
  stepId: string | null;
  status: RollStatus;
  colorId?: string | null;
  qty: number;
  producedInStepId?: string | null;
  batchSplitId?: string | null;
}): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      colorId: opts.colorId ?? null,
      initialQty: opts.qty,
      currentQty: opts.qty,
      status: opts.status,
      qualityGrade: "1.KALITE",
      qualityGradeId: GRADE,
      width: WIDTH,
      currentStepId: opts.stepId,
      producedInStepId: opts.producedInStepId ?? null,
      batchSplitId: opts.batchSplitId ?? null,
      createdById: ADMIN,
    },
  });
  if (opts.stepId) {
    await prisma.rollMovement.create({
      data: { rollId: r.id, workOrderStepId: opts.stepId, qtyIn: opts.qty, operatorId: ADMIN },
    });
  }
  return r.id;
}

/** Serbest ham stok top (currentStepId null, STOCK). */
async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      qualityGrade: "1.KALITE",
      qualityGradeId: GRADE,
      width: WIDTH,
      createdById: ADMIN,
    },
  });
  return r.id;
}

/** Topu bir adımdan sonrakine ilerlet (movement kapat + yeni aç). */
async function advance(rollId: string, fromStep: string, toStep: string): Promise<void> {
  const r = await prisma.roll.findUnique({ where: { id: rollId }, select: { currentQty: true } });
  await prisma.rollMovement.updateMany({
    where: { rollId, workOrderStepId: fromStep, exitedAt: null },
    data: { exitedAt: new Date(), qtyOut: r!.currentQty },
  });
  await prisma.roll.update({ where: { id: rollId }, data: { currentStepId: toStep } });
  await prisma.rollMovement.create({
    data: { rollId, workOrderStepId: toStep, qtyIn: r!.currentQty, operatorId: ADMIN },
  });
}

/** Fason dalı: stok topları boyahaneye sevk. RETURNED ise kabul edip born roll doğur. */
async function fasonWave(
  woId: string,
  count: number,
  qty: number,
  receive: boolean,
): Promise<{ dispatchNo: string; bornId: string | null }> {
  const rollIds: string[] = [];
  for (let i = 0; i < count; i++) rollIds.push(await stockRoll(qty));
  const d = await sub.dispatch(
    { workOrderId: woId, stepId: WS.boya, subcontractorId: SUB, rollIds },
    ADMIN,
  );
  const dispatchNo = (d.data as { dispatchNo: string }).dispatchNo;
  if (!receive) return { dispatchNo, bornId: null };
  const bornQty = Math.round(qty * count * 0.96);
  await sub.receive(
    {
      workOrderId: woId,
      stepId: WS.boya,
      subcontractorId: SUB,
      returns: rollIds.map((rollId) => ({ rollId })),
      newRolls: [{ qty: bornQty }],
    },
    ADMIN,
  );
  const born = await prisma.roll.findFirst({
    where: { parentReceipt: { workOrderId: woId }, currentStepId: WS.kursun, status: RollStatus.IN_PRODUCTION, parentRollId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return { dispatchNo, bornId: born?.id ?? null };
}

(async () => {
  // ── 1) İş emri + 4 adımlı rota + refakat kartı ──
  const stamp = `${Date.now()}`.slice(-5);
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TEST-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 5000,
      targetItemId: ITEM,
      targetColorId: COLOR,
      dyehouseNote: "Lacivert, ton tutturulması önemli. Numune onaylı.",
      plannedEndDate: new Date(Date.now() + 14 * 86400000).toISOString(),
      steps: {
        create: [
          { stationId: ST.KK1, stepSequence: 1, status: "ACTIVE" },
          { stationId: ST.BOYA, stepSequence: 2, status: "ACTIVE", requiredCategoryId: BOYA_CAT, plannedSubcontractorId: SUB },
          { stationId: ST.KURSUN, stepSequence: 3, status: "ACTIVE" },
          { stationId: ST.TAMBUR, stepSequence: 4, status: "ACTIVE" },
        ],
      },
    },
    include: { steps: true },
  });
  for (const s of wo.steps) {
    if (s.stationId === ST.KK1) WS.kk1 = s.id;
    else if (s.stationId === ST.BOYA) WS.boya = s.id;
    else if (s.stationId === ST.KURSUN) WS.kursun = s.id;
    else if (s.stationId === ST.TAMBUR) WS.tambur = s.id;
  }
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  console.log(`İş emri: ${wo.batchNumber} (${wo.id})`);

  // ── 2) KK1'de bekleyen ham toplar (yeni girmiş) ──
  await placeRoll({ stepId: WS.kk1, status: RollStatus.IN_PRODUCTION, qty: 320, producedInStepId: WS.kk1 });
  await placeRoll({ stepId: WS.kk1, status: RollStatus.IN_PRODUCTION, qty: 280, producedInStepId: WS.kk1 });
  console.log("✓ KK1'de 2 ham top (sevk bekliyor)");

  // ── 3) Boyahane adımında sevk bekleyen ham toplar (KK1 bitmiş) ──
  await placeRoll({ stepId: WS.boya, status: RollStatus.IN_PRODUCTION, qty: 300, producedInStepId: WS.kk1 });
  await placeRoll({ stepId: WS.boya, status: RollStatus.IN_PRODUCTION, qty: 300, producedInStepId: WS.kk1 });
  console.log("✓ Boyahane'de 2 ham top (Fason Sevk bekliyor)");

  // ── 4) FASON DALLARI (farklı konumlarda) ──
  const open = await fasonWave(wo.id, 2, 300, false);
  console.log(`✓ Dal AÇIK: ${open.dispatchNo} (boyahanede, Fason Kabul bekliyor)`);

  const atKursun = await fasonWave(wo.id, 2, 250, true);
  console.log(`✓ Dal DÖNDÜ→Kurşun: ${atKursun.dispatchNo}`);

  const atTambur = await fasonWave(wo.id, 2, 260, true);
  if (atTambur.bornId) await advance(atTambur.bornId, WS.kursun, WS.tambur);
  console.log(`✓ Dal DÖNDÜ→Tambur: ${atTambur.dispatchNo}`);

  const done = await fasonWave(wo.id, 2, 250, true);
  if (done.bornId) {
    await advance(done.bornId, WS.kursun, WS.tambur);
    const born = await prisma.roll.findUnique({ where: { id: done.bornId }, select: { currentQty: true, batchSplitId: true } });
    const total = Number(born!.currentQty);
    const half = Math.round(total / 2);
    await prisma.rollMovement.updateMany({ where: { rollId: done.bornId, workOrderStepId: WS.tambur, exitedAt: null }, data: { exitedAt: new Date(), qtyOut: total } });
    await prisma.roll.update({ where: { id: done.bornId }, data: { status: RollStatus.TAMBUR_CONSUMED, currentStepId: null, currentQty: 0 } });
    for (const q of [half, total - half]) {
      await prisma.roll.create({
        data: {
          barcode: barcode(), itemId: ITEM, colorId: COLOR,
          initialQty: q, currentQty: q, status: RollStatus.WAREHOUSE,
          qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH,
          producedInStepId: WS.tambur, parentRollId: done.bornId,
          batchSplitId: born!.batchSplitId, createdById: ADMIN,
        },
      });
    }
  }
  console.log(`✓ Dal DÖNDÜ→Depo (Tambur kesimi, 2 depo topu): ${done.dispatchNo}`);

  // ── 5) Serbest stok (Fason Sevk auto-attach / KK1 testi için) ──
  await stockRoll(500);
  await stockRoll(500);
  console.log("✓ 2 serbest ham stok top (PATOS)");

  // ── 6) Özet ──
  const branches = await new WorkOrderService().getBranches(wo.id);
  console.log(`\n✅ ${wo.batchNumber} hazır. Dallar:`);
  for (const b of (branches.data as { branches: Array<Record<string, unknown>> }).branches) {
    const pos = (b.currentPositions as Array<{ label: string; count: number; totalMeters: number }>)
      .map((p) => `${p.label}:${p.count}/${p.totalMeters}m`).join(", ") || "fasonda";
    console.log(`   ${b.dispatchNo} ${String(b.status).padEnd(9)} → ${pos}`);
  }
  console.log(`\nElectron: İş Emirleri → ${wo.batchNumber} → "Tam Ekran Aç" (dağılım şeridi + Gantt + lane)`);
  console.log("Mobil: refakat kartı ile WO'yu okut — KK1 / Fason Sevk / Fason Kabul / Kurşun / Tambur / Depo hepsinde aksiyon var.");
  await prisma.$disconnect();
})().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
