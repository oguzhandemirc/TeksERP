// TEST (O2): rota-atlama uyarısı (ROUTE_SKIP) + allowRouteSkip onayı + transfer false-positive yok.
// Çalıştır: npx tsx scripts/test_route_skip_warning.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { AppError } from "../src/utils/app-error";
import { RollStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_ZIMPARA = "", ST_BOYA = "", ST_TAMBUR = "", SUB_KESTEL = "", SUB_BOYER = "";
const WIDTH = 250;
async function fx(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  SUB_KESTEL = (await ensureTestSander()).id;
  SUB_BOYER = (await ensureTestDyeHouse()).id;
}
const sub = new SubcontractorService();
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
let bc = 0;
function barcode(): string { bc++; return `TST-RSK-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }
async function freeStock(qty: number): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}

let woId = "";
const stepIds: string[] = [];

async function main(): Promise<void> {
  await fx();
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-RSK-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB_KESTEL },
        { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", plannedSubcontractorId: SUB_BOYER },
        { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woId = wo.id;
  const zimparaStep = wo.steps[0].id, boyaStep = wo.steps[1].id;
  stepIds.push(...wo.steps.map((s) => s.id));
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  // VAKA 1: serbest stoğu DOĞRUDAN boyahaneye (zımpara PENDING) → ROUTE_SKIP
  const F1 = await freeStock(300);
  let err: AppError | null = null;
  try {
    await sub.dispatch({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [F1] }, ADMIN);
  } catch (e) { err = e as AppError; }
  check("Doğrudan boyahaneye sevk ROUTE_SKIP fırlattı", err?.details?.code === "ROUTE_SKIP", String(err?.details?.code));
  check("ROUTE_SKIP atlanan adım = Zımpara", (err?.details?.skippedStep as { stationName?: string } | undefined)?.stationName?.includes("Zımpara") === true, (err?.details?.skippedStep as { stationName?: string } | undefined)?.stationName ?? "?");

  // VAKA 2: allowRouteSkip ile bilinçli onay → başarılı
  await sub.dispatch({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [F1], allowRouteSkip: true }, ADMIN);
  const f1 = await prisma.roll.findUnique({ where: { id: F1 }, select: { status: true, currentStepId: true } });
  check("allowRouteSkip:true ile sevk başarılı (AT_SUBCONTRACTOR @ boyahane)", f1?.status === RollStatus.AT_SUBCONTRACTOR && f1?.currentStepId === boyaStep, String(f1?.status));

  // VAKA 3: zımparaya (1. adım) sevk → atlama YOK
  const F2 = await freeStock(400);
  let err3: AppError | null = null;
  try {
    await sub.dispatch({ workOrderId: woId, stepId: zimparaStep, subcontractorId: SUB_KESTEL, rollIds: [F2] }, ADMIN);
  } catch (e) { err3 = e as AppError; }
  check("İlk fason adımına (zımpara) sevk ROUTE_SKIP atmadı", err3 === null, err3?.message ?? "");

  // VAKA 4: zımparadan boyahaneye AKTARIM → ROUTE_SKIP yanlış tetiklenmez
  let err4: AppError | null = null;
  try {
    await sub.transferToNextFason({ workOrderId: woId, stepId: zimparaStep }, ADMIN);
  } catch (e) { err4 = e as AppError; }
  check("transferToNextFason ROUTE_SKIP'e takılmadı", err4 === null, err4?.message ?? "");

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceipt: { workOrderId: woId } }, { barcode: { startsWith: "TST-RSK-" } }] }, select: { id: true } });
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
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, woId] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrder.delete({ where: { id: woId } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
