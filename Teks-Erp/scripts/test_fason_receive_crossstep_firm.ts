// REGRESYON (F74): Aynı parti (batchId) birden fazla FASON adımından geçmişse,
// önceki adımın kabul edilmiş dispatch'i hâlâ cancelledAt=null kalır. receive()
// firmayı batchId → dispatch ile çözerken stepId scope'u YOKSA, batchId→firma
// 1'e-çok olur; Map bayat (önceki adım) firmayı tutar ve DOĞRU firmaya yapılan
// kabulde bile "Seçilen toplardan biri farklı bir fason firmasına ait" hatası fırlatır.
//
// Canlı hata: IE1507260003 — parti Zımpara(Kestel)→Boyahane(Boyer) geçmiş; Boyahane'den
// Boyer'a kabul denemesinde bayat Kestel kaydı yüzünden "farklı firma" hatası.
//
// Bu test o yapısal durumu doğrudan kurar (aynı batch, iki adımda iki firma dispatch'i)
// ve Boyahane kabulünün BAŞARILI olmasını doğrular. stepId scope'u geri alınırsa kırılır.
//
// Çalıştır: npx tsx scripts/test_fason_receive_crossstep_firm.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

let ITEM = "";
let GRADE = "";
let ADMIN = "";
let ST_ZIMPARA = "";
let ST_BOYA = "";
let ST_TAMBUR = "";
let SUB_BOYER = "";
let SUB_KESTEL = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "Station ZIMPARA_FASON");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "Station TAMBUR_1");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
  SUB_KESTEL = (await ensureTestSander()).id;
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-XSF-${rand}${bc}`;
}

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

let woId = "";
const stepIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();
  const stamp = `${Date.now()}`.slice(-6);
  // Rota: [1] Zımpara (Fason) → [2] Boyahane (Fason) → [3] Tambur
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-XSF-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_ZIMPARA, stepSequence: 1, status: "COMPLETED" },
          { stationId: ST_BOYA, stepSequence: 2, status: "PENDING" },
          { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woId = wo.id;
  const zimparaStep = wo.steps[0].id;
  const boyaStep = wo.steps[1].id;
  const tamburStep = wo.steps[2].id;
  stepIds.push(zimparaStep, boyaStep, tamburStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  console.log(`\nİş emri: ${wo.workOrderNumber}`);
  console.log(`  Rota: [1] Zımpara → [2] Boyahane → [3] Tambur\n`);

  // ── Güncel durum: 4 top Boyahane'de BOYER'a fasonda ──
  const rolls = [await stockRoll(300), await stockRoll(300), await stockRoll(300), await stockRoll(300)];
  await sub.dispatch(
    { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: rolls },
    ADMIN,
  );
  const dispatched = await prisma.roll.findMany({
    where: { id: { in: rolls } },
    select: { status: true, currentStepId: true, batchId: true },
  });
  check(
    "4 top Boyahane'de AT_SUBCONTRACTOR (Boyer sevki)",
    dispatched.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR && r.currentStepId === boyaStep),
  );
  const batchId = dispatched[0].batchId;
  check("4 top tek partide", batchId !== null && dispatched.every((r) => r.batchId === batchId), String(batchId));

  // ── BAYAT KAYIT: aynı parti, önceki adımda (Zımpara) KESTEL'e kabul edilmiş dispatch,
  //    hâlâ cancelledAt=null. Canlı DB'deki FS9 (Kestel@Zımpara) muadili. ──
  await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: `SD-STALE-${stamp}`,
      workOrderId: woId,
      batchId: batchId!,
      stepId: zimparaStep,
      subcontractorId: SUB_KESTEL,
      totalQty: 1200,
      cancelledAt: null,
      directShippedAt: null,
    },
  });
  const openForBatch = await prisma.subcontractorDispatch.findMany({
    where: { batchId: batchId!, cancelledAt: null },
    select: { stepId: true, subcontractorId: true },
  });
  check(
    "Parti için 2 açık (cancelledAt=null) dispatch var — bug'ın yapısal koşulu",
    openForBatch.length === 2,
    `${openForBatch.length} dispatch`,
  );

  // ── KRİTİK: Boyahane'den BOYER'a kabul. stepId scope'u ile SADECE Boyer çözülmeli.
  //    Fix öncesi: Map bayat Kestel'i tutup "farklı firma" fırlatabiliyordu. ──
  console.log("\nKRİTİK: Boyahane'den Boyer'a fason kabul (bayat Kestel kaydına rağmen)");
  let receiveErr: string | null = null;
  try {
    await sub.receive(
      {
        workOrderId: woId,
        stepId: boyaStep,
        subcontractorId: SUB_BOYER,
        returns: rolls.map((rollId) => ({ rollId })),
        newRolls: [{ qty: 1150 }],
      },
      ADMIN,
    );
  } catch (e) {
    receiveErr = e instanceof Error ? e.message : String(e);
  }
  check(
    "Boyahane kabulü BAŞARILI (bayat Zımpara/Kestel dispatch'i firma çözümünü BOZMADI)",
    receiveErr === null,
    receiveErr ?? "",
  );

  const consumed = await prisma.roll.findMany({
    where: { id: { in: rolls } },
    select: { status: true },
  });
  check(
    "Orijinal 4 top SUBCONTRACTOR_CONSUMED",
    receiveErr === null && consumed.every((r) => r.status === RollStatus.SUBCONTRACTOR_CONSUMED),
  );
  const born = await prisma.roll.findFirst({
    where: { parentReceipt: { workOrderId: woId }, parentRollId: null },
    orderBy: { createdAt: "desc" },
    select: { currentStepId: true, status: true },
  });
  check("Kabulde açık kumaş doğdu + Tambur'a ilerledi", born?.currentStepId === tamburStep, `step=${born?.currentStepId === tamburStep ? "Tambur" : String(born?.currentStepId)}`);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: stepIds } },
          { producedInStepId: { in: stepIds } },
          { parentReceipt: { workOrderId: woId } },
          { barcode: { startsWith: "TST-XSF-" } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);

    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, woId] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrder.delete({ where: { id: woId } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
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
