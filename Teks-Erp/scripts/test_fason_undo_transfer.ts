// TEST (O1): "Aktarımı Geri Al" (undoTransfer) — yanlış fason→fason aktarımını geri sar.
// Boyahane sevki + kaynak kabul atomik iptal → orijinaller kaynak fasona (batchSplitId
// korunarak) AT_SUBCONTRACTOR döner; born toplar CANCELLED; dallar temiz.
// Çalıştır: npx tsx scripts/test_fason_undo_transfer.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
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
  SUB_KESTEL = need(await prisma.subcontractor.findFirst({ where: { code: "KESTEL" }, select: { id: true } }), "KESTEL");
  SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "BOYER");
}

const sub = new SubcontractorService();
const woSvc = new WorkOrderService();
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
let bc = 0;
function barcode(): string { bc++; return `TST-UND-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }
async function rollAtStep(qty: number, stepId: string): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION, currentStepId: stepId, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}

const woIds: string[] = [];

interface PreviewShape {
  safe: boolean;
  blockingReasons: string[];
  bornRolls: { id: string }[];
  sourceReceipts: { id: string; receiptNo: string; originalRolls: { id: string }[] }[];
}
interface BranchShape {
  dispatchId: string;
  status: string;
  isTransferOutput: boolean;
  currentPositions: { label: string }[];
}

async function makeWo(): Promise<{ woId: string; zimparaStep: string; boyaStep: string }> {
  const stamp = `${Date.now()}`.slice(-6) + woIds.length;
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-UND-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB_KESTEL },
        { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", plannedSubcontractorId: SUB_BOYER },
        { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  return { woId: wo.id, zimparaStep: wo.steps[0].id, boyaStep: wo.steps[1].id };
}

async function main(): Promise<void> {
  await fx();

  // ───────────────────────── WO1: HAPPY PATH ─────────────────────────
  const { woId, zimparaStep, boyaStep } = await makeWo();
  const A = await rollAtStep(300, zimparaStep);
  const B = await rollAtStep(300, zimparaStep);
  const zimDispatch = await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep }, ADMIN);
  const zimDispatchId = (zimDispatch.data as { id: string }).id;
  const aDisp = await prisma.roll.findUnique({ where: { id: A }, select: { batchSplitId: true } });
  check("Zımpara sevki sonrası A.batchSplitId = zımpara dispatch", aDisp?.batchSplitId === zimDispatchId, String(aDisp?.batchSplitId === zimDispatchId));

  // Aktarım: zımpara → boyahane
  const transferRes = await sub.transferToNextFason({ workOrderId: woId, stepId: zimparaStep }, ADMIN);
  const boyaDispatchId = (transferRes.data as { id: string }).id;
  const bornBefore = await prisma.roll.findMany({ where: { parentReceipt: { workOrderId: woId }, currentStepId: boyaStep, status: RollStatus.AT_SUBCONTRACTOR }, select: { id: true } });
  check("Aktarım sonrası born toplar AT_SUBCONTRACTOR @ boyahane", bornBefore.length === 2, `adet=${bornBefore.length}`);

  // Preview: güvenli
  const prevRes = await sub.getUndoTransferPreview(boyaDispatchId);
  const prev = prevRes.data as PreviewShape;
  check("Preview safe=true", prev.safe === true, prev.blockingReasons.join("; "));
  check("Preview born toplar 2", prev.bornRolls.length === 2, `adet=${prev.bornRolls.length}`);
  check("Preview kaynak kabul >=1", prev.sourceReceipts.length >= 1, `adet=${prev.sourceReceipts.length}`);

  // Geri al
  await sub.undoTransfer(boyaDispatchId, "yanlış aktarım — geri alma testi", ADMIN);

  const boyaD = await prisma.subcontractorDispatch.findUnique({ where: { id: boyaDispatchId }, select: { cancelledAt: true } });
  check("Boyahane sevki CANCELLED", boyaD?.cancelledAt !== null, String(boyaD?.cancelledAt !== null));
  const bornAfter = await prisma.roll.findMany({ where: { id: { in: bornBefore.map((r) => r.id) } }, select: { status: true } });
  check("Born toplar CANCELLED", bornAfter.every((r) => r.status === RollStatus.CANCELLED), bornAfter.map((r) => r.status).join(","));
  const aAfter = await prisma.roll.findUnique({ where: { id: A }, select: { status: true, currentStepId: true, batchSplitId: true } });
  const bAfter = await prisma.roll.findUnique({ where: { id: B }, select: { status: true, currentStepId: true } });
  check("A geri döndü: AT_SUBCONTRACTOR @ zımpara", aAfter?.status === RollStatus.AT_SUBCONTRACTOR && aAfter?.currentStepId === zimparaStep, `${aAfter?.status}`);
  check("A.batchSplitId KORUNDU (zımpara lane)", aAfter?.batchSplitId === zimDispatchId, String(aAfter?.batchSplitId === zimDispatchId));
  check("B geri döndü: AT_SUBCONTRACTOR @ zımpara", bAfter?.status === RollStatus.AT_SUBCONTRACTOR && bAfter?.currentStepId === zimparaStep, `${bAfter?.status}`);

  const zStep = await prisma.workOrderStep.findUnique({ where: { id: zimparaStep }, select: { status: true } });
  const bStep = await prisma.workOrderStep.findUnique({ where: { id: boyaStep }, select: { status: true } });
  check("Zımpara adımı yeniden ACTIVE", zStep?.status === "ACTIVE", String(zStep?.status));
  check("Boyahane adımı PENDING", bStep?.status === "PENDING", String(bStep?.status));

  // Dallar: tam 1 görünür OPEN dal (zımpara) + boyahane CANCELLED; boş RETURNED artefaktı yok
  const branchesRes = await woSvc.getBranches(woId);
  const branches = (branchesRes.data as { branches: BranchShape[] }).branches;
  const openBranches = branches.filter((b) => b.status === "OPEN");
  const cancelledBranches = branches.filter((b) => b.status === "CANCELLED");
  const emptyReturned = branches.filter((b) => b.status === "RETURNED" && b.currentPositions.length === 0);
  check("getBranches: tam 1 OPEN dal (zımpara geri döndü)", openBranches.length === 1, `OPEN=${openBranches.length}`);
  check("getBranches: boyahane dalı CANCELLED", cancelledBranches.some((b) => b.dispatchId === boyaDispatchId), `CANCELLED=${cancelledBranches.length}`);
  check("getBranches: boş RETURNED artefaktı yok", emptyReturned.length === 0, `boşRETURNED=${emptyReturned.length}`);

  // Negatif: çift undo → 409
  let dbl: AppError | null = null;
  try { await sub.undoTransfer(boyaDispatchId, "ikinci kez", ADMIN); } catch (e) { dbl = e as AppError; }
  check("Çift undo reddedildi (zaten iptal)", dbl !== null, dbl?.message ?? "");

  // Negatif: aktarım-olmayan (zımpara) sevkte undo → red
  const zimPrev = (await sub.getUndoTransferPreview(zimDispatchId)).data as PreviewShape;
  check("Aktarım-olmayan sevk preview safe=false", zimPrev.safe === false, zimPrev.blockingReasons.join("; "));
  let nonTransfer: AppError | null = null;
  try { await sub.undoTransfer(zimDispatchId, "aktarım değil", ADMIN); } catch (e) { nonTransfer = e as AppError; }
  check("Aktarım-olmayan sevkte undoTransfer reddedildi", nonTransfer !== null, nonTransfer?.message ?? "");

  // ───────────────── WO2: boyahane KABUL yaptıysa undo reddedilir ─────────────────
  const wo2 = await makeWo();
  const C = await rollAtStep(400, wo2.zimparaStep);
  await sub.bulkDispatchStep({ workOrderId: wo2.woId, stepId: wo2.zimparaStep }, ADMIN);
  const transfer2 = await sub.transferToNextFason({ workOrderId: wo2.woId, stepId: wo2.zimparaStep }, ADMIN);
  const boya2DispatchId = (transfer2.data as { id: string }).id;
  const born2 = await prisma.roll.findMany({ where: { parentReceipt: { workOrderId: wo2.woId }, currentStepId: wo2.boyaStep, status: RollStatus.AT_SUBCONTRACTOR }, select: { id: true, currentQty: true } });
  // Boyahane gerçek kabul yapar → born toplar tüketilir
  await sub.receive({ workOrderId: wo2.woId, stepId: wo2.boyaStep, subcontractorId: SUB_BOYER, returns: born2.map((r) => ({ rollId: r.id })), newRolls: born2.map((r) => ({ qty: Number(r.currentQty) })) }, ADMIN);
  const born2Prev = (await sub.getUndoTransferPreview(boya2DispatchId)).data as PreviewShape;
  check("Boyahane kabul sonrası preview safe=false", born2Prev.safe === false, born2Prev.blockingReasons.join("; "));
  let received: AppError | null = null;
  try { await sub.undoTransfer(boya2DispatchId, "kabul sonrası", ADMIN); } catch (e) { received = e as AppError; }
  check("Boyahane kabul yapılmış aktarımda undo reddedildi", received !== null, received?.message ?? "");
  void C;

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const stepRows = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const stepIds = stepRows.map((s) => s.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceipt: { workOrderId: { in: woIds } } }, { barcode: { startsWith: "TST-UND-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
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
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
