// TEST: Rotada ARDIŞIK İKİ FASON adımı (Boyahane → Zımpara) — ikisi de başta.
//
// Soru: İlk fason adımına (Boyahane) sevk + kabul yapılınca, ikinci fason
// adımından (Zımpara) da "geçmiş" mi sayılır, yoksa hata mı verir, yoksa top
// ikinci fason adımında bekler mi?
//
// Rota: [1] Boyahane (Fason) → [2] Zımpara (Fason) → [3] Tambur (internal)
//
// Çalıştır: npx ts-node scripts/test_consecutive_fason.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";

const ITEM = "9d49919d-b1d7-4e06-bb68-f55c5fb09911"; // PATOS
const GRADE = "a1b5b3e1-e899-4ac3-9d57-b329491056b1"; // 1.KALITE
const ADMIN = "ff0baa78-8a0f-469e-8f1a-437efb3d4499";
const ST_BOYA = "9254a500-68ff-4b88-af15-0e3182e3b14e"; // Boyahane (Fason)
const ST_ZIMPARA = "776f40bf-4116-4d7f-8c42-801a6496d904"; // Zımpara (Fason)
const ST_TAMBUR = "42270197-9e09-4984-a80f-703df2beec2e"; // Tambur
const SUB_BOYER = "f83bcbf5-1f59-4eef-953d-fd4526c5c070"; // Boyer Boyacılık
const SUB_KESTEL = "9050b4ba-0e85-44b6-a523-01332d157957"; // Kestel Zımpara
const WIDTH = 250;

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
  return `TST-CF-${rand}${bc}`;
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
  // ── 1) İş emri: ardışık iki fason adımı + tambur ──
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-CF-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
          { stationId: ST_ZIMPARA, stepSequence: 2, status: "PENDING" },
          { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woId = wo.id;
  const boyaStep = wo.steps[0].id;
  const zimparaStep = wo.steps[1].id;
  const tamburStep = wo.steps[2].id;
  stepIds.push(boyaStep, zimparaStep, tamburStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  console.log(`\nİş emri: ${wo.batchNumber}`);
  console.log(`  Rota: [1] Boyahane → [2] Zımpara → [3] Tambur\n`);

  // ── 2) Stok topları yarat ──
  const r1 = await stockRoll(300);
  const r2 = await stockRoll(300);

  // ── 3) FASON SEVK → BOYAHANE (adım 1) ──
  console.log("ADIM 1: Boyahane'ye fason sevk");
  await sub.dispatch(
    { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1, r2] },
    ADMIN,
  );
  const afterDispatch = await prisma.roll.findMany({
    where: { id: { in: [r1, r2] } },
    select: { status: true, currentStepId: true },
  });
  check(
    "Sevk sonrası toplar AT_SUBCONTRACTOR + Boyahane adımında",
    afterDispatch.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR && r.currentStepId === boyaStep),
    afterDispatch.map((r) => r.status).join(","),
  );

  // ── 4) FASON KABUL ← BOYAHANE — burada kritik soru ──
  console.log("\nADIM 2: Boyahane'den fason kabul (newRolls ile açık kumaş doğar)");
  let receiveErr: string | null = null;
  try {
    await sub.receive(
      {
        workOrderId: woId,
        stepId: boyaStep,
        subcontractorId: SUB_BOYER,
        returns: [{ rollId: r1 }, { rollId: r2 }],
        newRolls: [{ qty: 580 }],
      },
      ADMIN,
    );
  } catch (e) {
    receiveErr = e instanceof Error ? e.message : String(e);
  }
  check("Boyahane kabulü HATA VERMEDİ (ardışık fason olmasına rağmen)", receiveErr === null, receiveErr ?? "");

  // Orijinal toplar tüketildi mi?
  const origAfter = await prisma.roll.findMany({
    where: { id: { in: [r1, r2] } },
    select: { status: true, currentStepId: true },
  });
  check(
    "Orijinal toplar SUBCONTRACTOR_CONSUMED + step temizlendi",
    origAfter.every((r) => r.status === RollStatus.SUBCONTRACTOR_CONSUMED && r.currentStepId === null),
  );

  // Doğan açık kumaş topu nerede?
  const born = await prisma.roll.findFirst({
    where: { parentReceipt: { workOrderId: woId }, parentRollId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, currentStepId: true, producedInStepId: true },
  });
  check("Boyahane kabulünde açık kumaş topu doğdu", born !== null);

  // *** KULLANICININ ASIL SORUSU ***
  check(
    "Doğan top ZIMPARA adımında bekliyor (İKİNCİ fasona OTOMATİK GEÇMEDİ)",
    born?.currentStepId === zimparaStep,
    `currentStepId === ${born?.currentStepId === zimparaStep ? "Zımpara" : born?.currentStepId === tamburStep ? "Tambur(YANLIŞ-skip!)" : String(born?.currentStepId)}`,
  );
  check(
    "Doğan top Tambur'a ATLAMADI (skip yok)",
    born?.currentStepId !== tamburStep,
  );
  check(
    "Doğan top IN_PRODUCTION (henüz Zımpara fasonuna SEVK EDİLMEDİ, AT_SUBCONTRACTOR değil)",
    born?.status === RollStatus.IN_PRODUCTION,
    String(born?.status),
  );
  check("Doğan topun üretildiği adım = Boyahane", born?.producedInStepId === boyaStep);

  // Adım statüleri
  const steps1 = await prisma.workOrderStep.findMany({
    where: { id: { in: stepIds } },
    select: { id: true, status: true },
  });
  const stMap = (id: string): StepStatus => steps1.find((s) => s.id === id)!.status;
  check("Boyahane adımı COMPLETED", stMap(boyaStep) === StepStatus.COMPLETED, stMap(boyaStep));
  check("Zımpara adımı ACTIVE (top burada bekliyor ama henüz fasonda değil)", stMap(zimparaStep) === StepStatus.ACTIVE, stMap(zimparaStep));
  check("Tambur adımı hâlâ PENDING (top oraya hiç ulaşmadı)", stMap(tamburStep) === StepStatus.PENDING, stMap(tamburStep));

  // ── 5) İKİNCİ DÖNGÜ: Zımpara'ya sevk + kabul (doğan top dispatch'e uygun mu?) ──
  console.log("\nADIM 3: Doğan topu Zımpara fasonuna sevk (ayrı bir döngü gerekiyor)");
  let dispatch2Err: string | null = null;
  try {
    await sub.dispatch(
      { workOrderId: woId, stepId: zimparaStep, subcontractorId: SUB_KESTEL, rollIds: [born!.id] },
      ADMIN,
    );
  } catch (e) {
    dispatch2Err = e instanceof Error ? e.message : String(e);
  }
  check("Doğan top Zımpara'ya sevk edilebildi (IN_PRODUCTION @ bu adım kabul)", dispatch2Err === null, dispatch2Err ?? "");

  const bornAfterD2 = await prisma.roll.findUnique({
    where: { id: born!.id },
    select: { status: true, currentStepId: true },
  });
  check(
    "Zımpara sevki sonrası doğan top AT_SUBCONTRACTOR @ Zımpara",
    bornAfterD2?.status === RollStatus.AT_SUBCONTRACTOR && bornAfterD2?.currentStepId === zimparaStep,
  );

  console.log("\nADIM 4: Zımpara'dan kabul (sonraki adım Tambur)");
  await sub.receive(
    {
      workOrderId: woId,
      stepId: zimparaStep,
      subcontractorId: SUB_KESTEL,
      returns: [{ rollId: born!.id }],
      newRolls: [{ qty: 560 }],
    },
    ADMIN,
  );
  const born2 = await prisma.roll.findFirst({
    where: { parentReceipt: { workOrderId: woId }, parentRollId: null, producedInStepId: zimparaStep },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, currentStepId: true },
  });
  check("Zımpara kabulünde yeni top doğdu", born2 !== null);
  check("Yeni top artık TAMBUR adımında (2 fason döngüsü sonra)", born2?.currentStepId === tamburStep, `currentStepId=${born2?.currentStepId === tamburStep ? "Tambur" : String(born2?.currentStepId)}`);
  check("Yeni top IN_PRODUCTION @ Tambur", born2?.status === RollStatus.IN_PRODUCTION);

  const steps2 = await prisma.workOrderStep.findMany({
    where: { id: { in: stepIds } },
    select: { id: true, status: true },
  });
  const stMap2 = (id: string): StepStatus => steps2.find((s) => s.id === id)!.status;
  check("Zımpara adımı şimdi COMPLETED", stMap2(zimparaStep) === StepStatus.COMPLETED, stMap2(zimparaStep));
  check("Tambur adımı şimdi ACTIVE (top oraya geldi)", stMap2(tamburStep) === StepStatus.ACTIVE, stMap2(tamburStep));

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    // İlgili tüm topları topla (başlangıç + doğan)
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: stepIds } },
          { producedInStepId: { in: stepIds } },
          { parentReceipt: { workOrderId: woId } },
          { barcode: { startsWith: "TST-CF-" } },
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
    // TravelerCard silinince TravelerCardScan cascade ile gider (step FK'sından önce)
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, woId] } } });
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
