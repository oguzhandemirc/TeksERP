// TEST (O3): getBranches öksüz boş dalları gizler; tekli-fason RETURNED dalı GİZLENMEZ.
// Çalıştır: npx tsx scripts/test_branch_no_empty.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_ZIMPARA = "", ST_BOYA = "", ST_TAMBUR = "", SUB_KESTEL = "", SUB_BOYER = "";
let GRADE_CODE = "";
const WIDTH = 250;

async function fx(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  SUB_KESTEL = (await ensureTestSander()).id;
  SUB_BOYER = (await ensureTestDyeHouse()).id;
}

const sub = new SubcontractorService();
const wos = new WorkOrderService();
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
let bc = 0;
function barcode(): string { bc++; return `TST-BNE-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }
async function rollAt(qty: number, stepId: string): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION, currentStepId: stepId, qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}
// Yeni lane shape (parti-modeli): lane-seviyesi `status`/`stepName` KALKTI. Sevk durumu
// artık `dispatches[].status` (OPEN|PARTIAL|RETURNED|CANCELLED|DIRECT_SHIPPED), mevcut
// istasyon `currentPositions[].label` (r.currentStep.station.name ya da statü etiketi).
type Position = { label: string; count: number; totalMeters: number };
type Dispatch = { stepName: string | null; status: string };
type Branch = { currentPositions: Position[]; dispatches: Dispatch[] };
const fmt = (bs: Branch[]) =>
  bs.map((b) => `${b.currentPositions.map((p) => p.label).join("|") || "—"}:${b.dispatches.map((d) => d.status).join(",") || "—"}:${b.currentPositions.length}`).join(" ; ");
async function getBranches(woId: string): Promise<Branch[]> {
  const res = await wos.getBranches(woId);
  return ((res.data as { batches: Branch[] } | null)?.batches) ?? [];
}

const woIds: string[] = [];
const allSteps: string[] = [];

async function makeWo(batch: string, steps: { stationId: string; planned?: string }[]): Promise<{ id: string; stepIds: string[] }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: batch, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: steps.map((s, i) => ({ stationId: s.stationId, stepSequence: i + 1, status: "PENDING", plannedSubcontractorId: s.planned ?? null })) },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  const stepIds = wo.steps.map((s) => s.id);
  allSteps.push(...stepIds);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  return { id: wo.id, stepIds };
}

async function main(): Promise<void> {
  await fx();
  const stamp = `${Date.now()}`.slice(-6);

  // ── VAKA 1: zımpara→boyahane→tambur, aktarım → boş zımpara dalı GİZLİ ──
  const w1 = await makeWo(`TST-BNE-A-${stamp}`, [
    { stationId: ST_ZIMPARA, planned: SUB_KESTEL },
    { stationId: ST_BOYA, planned: SUB_BOYER },
    { stationId: ST_TAMBUR },
  ]);
  await rollAt(300, w1.stepIds[0]);
  await rollAt(300, w1.stepIds[0]);
  await sub.bulkDispatchStep({ workOrderId: w1.id, stepId: w1.stepIds[0] }, ADMIN); // zımparaya sevk
  await sub.transferToNextFason({ workOrderId: w1.id, stepId: w1.stepIds[0] }, ADMIN); // boyahaneye aktar
  const b1 = await getBranches(w1.id);
  check("Aktarımdan sonra TAM 1 görünür dal (boş zımpara dalı gizli)", b1.length === 1, `dal=${b1.length}`);
  check("Görünür dal boyahane + dolu pozisyon", b1[0]?.currentPositions.some((p) => p.label.includes("Boyahane")) === true && b1[0].currentPositions.length > 0, fmt(b1));
  check("Hiç boş RETURNED dal yok", !b1.some((b) => b.dispatches.some((d) => d.status === "RETURNED") && b.currentPositions.length === 0));

  // ── VAKA 2: zımpara→tambur(internal), kabul → zımpara dalı RETURNED ama DOLU (gizlenMEZ) ──
  const w2 = await makeWo(`TST-BNE-B-${stamp}`, [
    { stationId: ST_ZIMPARA, planned: SUB_KESTEL },
    { stationId: ST_TAMBUR },
  ]);
  const r = await rollAt(400, w2.stepIds[0]);
  await sub.bulkDispatchStep({ workOrderId: w2.id, stepId: w2.stepIds[0] }, ADMIN);
  await sub.receive({ workOrderId: w2.id, stepId: w2.stepIds[0], subcontractorId: SUB_KESTEL, returns: [{ rollId: r }], newRolls: [{ qty: 400 }] }, ADMIN);
  const b2 = await getBranches(w2.id);
  check("Tekli-fason: zımpara dalı görünür (gizlenmedi)", b2.length === 1, `dal=${b2.length}`);
  check("Zımpara dalı RETURNED + born top pozisyonu dolu (Tambur)", b2[0]?.dispatches.some((d) => d.status === "RETURNED") === true && b2[0].currentPositions.length > 0, fmt(b2));

  console.log(`\nSONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (!woIds.length) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: allSteps } }, { producedInStepId: { in: allSteps } }, { parentReceipt: { workOrderId: { in: woIds } } }, { barcode: { startsWith: "TST-BNE-" } }] }, select: { id: true } });
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
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: rollIds } } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds] } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
