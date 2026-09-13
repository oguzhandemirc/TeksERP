// TEST: bulkDispatchStep top alt-küme seçimi (rollIds) — yalnız seçilen toplar sevk.
// Çalıştır: npx tsx scripts/test_bulk_dispatch_rollids.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestSander } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_ZIMPARA = "", ST_BOYA = "", ST_TAMBUR = "", SUB_KESTEL = "";
let GRADE_CODE = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${l}`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  SUB_KESTEL = (await ensureTestSander()).id;
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectReject(label: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  let msg: string | null = null;
  try { await fn(); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  check(label, msg !== null && msg.includes(needle), msg ?? "hata atılmadı");
}
let bc = 0;
function barcode(): string { bc++; return `TST-BDR-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }
async function rollAtStep(qty: number, stepId: string): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION, currentStepId: stepId, qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN },
  });
  return r.id;
}

let woId = "";
const stepIds: string[] = [];

async function main(): Promise<void> {
  await resolveFixtures();
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-BDR-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB_KESTEL },
        { stationId: ST_BOYA, stepSequence: 2, status: "PENDING" },
        { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woId = wo.id;
  const zimparaStep = wo.steps[0].id;
  stepIds.push(...wo.steps.map((s) => s.id));
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  const r1 = await rollAtStep(300, zimparaStep);
  const r2 = await rollAtStep(300, zimparaStep);
  const r3 = await rollAtStep(300, zimparaStep);

  // Yabancı id ile sevk → 400
  await expectReject(
    "Yabancı/uygunsuz id ile sevk reddedildi",
    () => sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep, rollIds: [r1, "00000000-0000-0000-0000-000000000000"] }, ADMIN),
    "artık sevke uygun değil",
  );

  // Alt-küme: yalnız r1, r2 sevk edilsin
  const res = await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep, rollIds: [r1, r2] }, ADMIN);
  const dispatchId = (res.data as { id: string }).id;
  const items = await prisma.subcontractorDispatchItem.count({ where: { dispatchId } });
  check("Sevk tam 2 kalem içeriyor (seçilen 2 top)", items === 2, `items=${items}`);

  const rolls = await prisma.roll.findMany({ where: { id: { in: [r1, r2, r3] } }, select: { id: true, status: true } });
  const st = (id: string) => rolls.find((r) => r.id === id)!.status;
  check("r1 AT_SUBCONTRACTOR", st(r1) === RollStatus.AT_SUBCONTRACTOR, st(r1));
  check("r2 AT_SUBCONTRACTOR", st(r2) === RollStatus.AT_SUBCONTRACTOR, st(r2));
  check("r3 SEÇİLMEDİ → hâlâ IN_PRODUCTION (bekliyor)", st(r3) === RollStatus.IN_PRODUCTION, st(r3));

  // Kalan r3'ü de seç → sevk
  await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep, rollIds: [r3] }, ADMIN);
  const r3after = await prisma.roll.findUnique({ where: { id: r3 }, select: { status: true } });
  check("r3 ayrı çağrıyla sevk edildi → AT_SUBCONTRACTOR", r3after?.status === RollStatus.AT_SUBCONTRACTOR, String(r3after?.status));

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceipt: { workOrderId: woId } }, { barcode: { startsWith: "TST-BDR-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: woId } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, woId] } } });
    await prisma.workOrder.delete({ where: { id: woId } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
