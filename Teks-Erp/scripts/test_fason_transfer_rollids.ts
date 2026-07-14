// TEST (KRİTİK): transferToNextFason rollIds alt-küme + born-roll precision.
// Kısmi aktarımda yalnız seçilen topların DOĞAN çocukları sevk edilmeli; boyahanede
// duran İLGİSİZ IN_PRODUCTION top SÜPÜRÜLMEMELİ (eski "tüm bekleyeni sevk et" bug'ı).
// Çalıştır: npx tsx scripts/test_fason_transfer_rollids.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_ZIMPARA = "", ST_BOYA = "", ST_TAMBUR = "", SUB_KESTEL = "", SUB_BOYER = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
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
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
let bc = 0;
function barcode(): string { bc++; return `TST-TRR-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }
async function rollAtStep(qty: number, stepId: string): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION, currentStepId: stepId, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}

let woId = "";
const stepIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-TRR-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
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

  // A, B zımparaya sevk → AT_SUBCONTRACTOR
  const A = await rollAtStep(300, zimparaStep);
  const B = await rollAtStep(300, zimparaStep);
  await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep }, ADMIN);

  // X: boyahanede duran İLGİSİZ IN_PRODUCTION top (önceki bir akıştan kalmış gibi)
  const X = await rollAtStep(999, boyaStep);

  // Kısmi aktarım: yalnız A
  await sub.transferToNextFason({ workOrderId: woId, stepId: zimparaStep, rollIds: [A] }, ADMIN);

  const aAfter = await prisma.roll.findUnique({ where: { id: A }, select: { status: true, currentStepId: true } });
  const bAfter = await prisma.roll.findUnique({ where: { id: B }, select: { status: true, currentStepId: true } });
  const xAfter = await prisma.roll.findUnique({ where: { id: X }, select: { status: true, currentStepId: true } });
  check("A tüketildi (SUBCONTRACTOR_CONSUMED)", aAfter?.status === RollStatus.SUBCONTRACTOR_CONSUMED, String(aAfter?.status));
  check("B SEÇİLMEDİ → hâlâ AT_SUBCONTRACTOR @ zımpara", bAfter?.status === RollStatus.AT_SUBCONTRACTOR && bAfter?.currentStepId === zimparaStep, `${bAfter?.status}`);
  check("X İLGİSİZ top SÜPÜRÜLMEDİ → hâlâ IN_PRODUCTION @ boyahane", xAfter?.status === RollStatus.IN_PRODUCTION && xAfter?.currentStepId === boyaStep, `${xAfter?.status}@${xAfter?.currentStepId === boyaStep ? "boya" : xAfter?.currentStepId}`);

  // A'dan doğan top: parentReceipt bu WO + producedInStepId=zımpara + boyahaneye sevk edildi (AT_SUBCONTRACTOR)
  const born = await prisma.roll.findMany({ where: { parentReceipt: { workOrderId: woId }, producedInStepId: zimparaStep, parentRollId: null }, select: { id: true, status: true, currentStepId: true } });
  check("A'dan TAM 1 born top doğdu", born.length === 1, `adet=${born.length}`);
  check("Born top AT_SUBCONTRACTOR @ boyahane (yalnız o sevk edildi)", born[0]?.status === RollStatus.AT_SUBCONTRACTOR && born[0]?.currentStepId === boyaStep, `${born[0]?.status}`);

  // İkinci aktarım: kalan B (rollIds vermeden = hepsi)
  await sub.transferToNextFason({ workOrderId: woId, stepId: zimparaStep }, ADMIN);
  const bAfter2 = await prisma.roll.findUnique({ where: { id: B }, select: { status: true } });
  check("İkinci aktarımda B de tüketildi", bAfter2?.status === RollStatus.SUBCONTRACTOR_CONSUMED, String(bAfter2?.status));
  const xFinal = await prisma.roll.findUnique({ where: { id: X }, select: { status: true } });
  check("X hâlâ dokunulmadı (iki aktarım sonrası)", xFinal?.status === RollStatus.IN_PRODUCTION, String(xFinal?.status));

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceipt: { workOrderId: woId } }, { barcode: { startsWith: "TST-TRR-" } }] }, select: { id: true } });
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
