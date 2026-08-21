// TEST: Fason adım notu → o adımın sevkine (dispatch.instruction) ve çeki listesine.
//
// Yeni model (Option A): WorkOrder.dyehouseNote KALDIRILDI. Her adımın kendi notu
// (WorkOrderStep.notes) var; FASON adımda bu not, sevk açılınca dispatch.instruction'a
// DEFAULT kopyalanır (operatör notu öncelikli) ve o adımın çeki listesine basılır.
// Farklı/çoklu fason adımı her biri KENDİ notunu taşır (global tek not yok).
//
// Rota: [1] Boyahane (Fason, notes=A) → [2] Zımpara (Fason, notes=B) → [3] Tambur
//
// Çalıştır: npx tsx scripts/test_fason_step_note_flow.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

// Fixture id'leri seed'den runtime'da çözülür (business key ile — hardcoded uuid yasak).
let ITEM = "";
let GRADE = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_ZIMPARA = "";
let ST_TAMBUR = "";
let SUB_BOYER = "";
let SUB_KESTEL = "";
const WIDTH = 250;

const BOYA_NOTE = "BOYA TALİMATI: yıkama yapma, matlaştır.";
const ZIMPARA_NOTE = "ZIMPARA TALİMATI: ince zımpara, hav bırakma.";

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "Station ZIMPARA_FASON");
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
  return `TST-FSN-${rand}${bc}`;
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

/** Bir adımın (cancelledAt=null) en yeni sevkinin kendi instruction'ı. */
async function latestDispatch(stepId: string): Promise<{ id: string; instruction: string | null }> {
  const d = await prisma.subcontractorDispatch.findFirst({
    where: { workOrderId: woId, stepId, cancelledAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, instruction: true },
  });
  if (!d) throw new Error(`Sevk bulunamadı: step ${stepId}`);
  return d;
}

let woId = "";
const stepIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();

  // ── 1) İş emri: iki fason adımı, her biri FARKLI not ──
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-FSN-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING", notes: BOYA_NOTE },
          { stationId: ST_ZIMPARA, stepSequence: 2, status: "PENDING", notes: ZIMPARA_NOTE },
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
  console.log(`\nİş emri: ${wo.workOrderNumber}`);
  console.log(`  Rota: [1] Boyahane (not=A) → [2] Zımpara (not=B) → [3] Tambur\n`);

  // ── 2) Boyahane'ye operatör NOTSUZ sevk → instruction = adım notu (A) ──
  console.log("ADIM 1: Boyahane'ye sevk (operatör talimatı YOK)");
  const r1 = await stockRoll(300);
  const r2 = await stockRoll(300);
  await sub.dispatch(
    { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1, r2] },
    ADMIN,
  );
  const d1 = await latestDispatch(boyaStep);
  check(
    "Operatör notsuz sevk → dispatch.instruction = Boyahane adım notu",
    d1.instruction === BOYA_NOTE,
    JSON.stringify(d1.instruction),
  );

  // ── 3) Boyahane'ye operatör notu VEREREK ikinci sevk → operatör notu öncelikli ──
  console.log("\nADIM 2: Boyahane'ye ikinci sevk (operatör talimatı VAR → override)");
  const OPERATOR_NOTE = "ACİL: numune ekte, tonu birebir tuttur.";
  const r3 = await stockRoll(200);
  await sub.dispatch(
    { workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r3], instruction: OPERATOR_NOTE },
    ADMIN,
  );
  const d2 = await latestDispatch(boyaStep);
  check(
    "Operatör talimatı verilince dispatch.instruction = operatör notu (adım notunu EZER)",
    d2.instruction === OPERATOR_NOTE,
    JSON.stringify(d2.instruction),
  );

  // ── 4) İlk sevkin overlay'i: instruction (kopya) + stepNote (fallback) ──
  console.log("\nADIM 3: dye-overlay — instruction vs stepNote alanları");
  const ov1 = (await sub.getDispatchDyeOverlay(d1.id)).data as {
    instruction: string | null;
    stepNote: string | null;
    instructionLocked: boolean;
  };
  check("overlay.stepNote = Boyahane adım notu (fallback kaynağı)", ov1.stepNote === BOYA_NOTE, JSON.stringify(ov1.stepNote));
  check("overlay.instruction = sevkin kendi talimatı (kopyalanan adım notu)", ov1.instruction === BOYA_NOTE);
  check("overlay.instructionLocked = false (henüz kabul/iptal yok)", ov1.instructionLocked === false);

  // updateInstruction → override; stepNote fallback DEĞİŞMEDEN kalır (ayrı alanlar).
  const FIX_NOTE = "DÜZELTME: pastel tona çek.";
  await sub.updateInstruction(d1.id, FIX_NOTE, ADMIN);
  const ov1b = (await sub.getDispatchDyeOverlay(d1.id)).data as { instruction: string | null; stepNote: string | null };
  check("updateInstruction sonrası overlay.instruction = düzeltme notu", ov1b.instruction === FIX_NOTE, JSON.stringify(ov1b.instruction));
  check("overlay.stepNote hâlâ adım notu (override fallback'tan AYRI)", ov1b.stepNote === BOYA_NOTE);

  // ── 5) Boyahane kabul → doğan top Zımpara adımında ──
  console.log("\nADIM 4: Boyahane kabul (born roll → Zımpara adımı)");
  await sub.receive(
    {
      workOrderId: woId,
      stepId: boyaStep,
      subcontractorId: SUB_BOYER,
      returns: [{ rollId: r1 }, { rollId: r2 }, { rollId: r3 }],
      newRolls: [{ qty: 760 }],
    },
    ADMIN,
  );
  const born = await prisma.roll.findFirst({
    where: { parentReceipt: { workOrderId: woId }, parentRollId: null, producedInStepId: boyaStep },
    orderBy: { createdAt: "desc" },
    select: { id: true, currentStepId: true },
  });
  check("Boyahane kabulünde açık kumaş topu doğdu @ Zımpara", born?.currentStepId === zimparaStep);

  // ── 6) Zımpara'ya operatör NOTSUZ sevk → instruction = Zımpara notu (B), A DEĞİL ──
  console.log("\nADIM 5: Zımpara'ya sevk (operatör talimatı YOK) — PER-STEP ispatı");
  await sub.dispatch(
    { workOrderId: woId, stepId: zimparaStep, subcontractorId: SUB_KESTEL, rollIds: [born!.id] },
    ADMIN,
  );
  const d3 = await latestDispatch(zimparaStep);
  check(
    "Zımpara sevki → dispatch.instruction = ZIMPARA adım notu (Boyahane notunu DEĞİL)",
    d3.instruction === ZIMPARA_NOTE,
    JSON.stringify(d3.instruction),
  );
  check("Zımpara talimatı, Boyahane talimatından FARKLI (global tek not yok)", d3.instruction !== BOYA_NOTE);

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
          { barcode: { startsWith: "TST-FSN-" } },
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
    // Donmuş resmi belgeler (PrintedDocument) — sevklere bağlı.
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: rollIds } } } });
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
