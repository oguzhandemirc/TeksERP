// TEST (Faz 3.2 / K11): çok-parti fason sevk.
//   Seçim 2+ partiye yayılıyorsa: strateji yok → 409 MULTI_BATCH; MERGE → en eskide
//   birleş (diğer kart VOID, boşalan silinir); SEPARATE → parti başına ayrı sevk.
// Çalıştır: npx tsx scripts/test_batch_multibatch_dispatch.ts
import prisma from "../src/lib/prisma";
import { ensureTestSander } from "./fixture-subcontractor";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { RollStatus } from "@prisma/client";

const WIDTH = 250;
const wos = new WorkOrderService();
const sub = new SubcontractorService();
let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void { if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); } else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); } }
let bcN = 0;
function bc(): string { bcN++; return `TST-K11-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bcN}`; }
let woId = "";

async function attachWave(item: string, grade: string, admin: string, n: number): Promise<{ batchId: string; rollIds: string[] }> {
  const bcs = Array.from({ length: n }, () => bc());
  for (const b of bcs) await prisma.roll.create({ data: { barcode: b, itemId: item, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: grade, width: WIDTH, createdById: admin } });
  const res = await wos.attachRolls(woId, bcs, admin);
  const rolls = await prisma.roll.findMany({ where: { barcode: { in: bcs } }, select: { id: true } });
  return { batchId: res.data!.batch!.id, rollIds: rolls.map((r) => r.id) };
}

async function main(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE");
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  const SUB = (await ensureTestSander()).id;

  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TST-K11-${stamp}`, type: "STOCK_PRODUCTION", status: "PLANNED", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB }] } },
    include: { steps: true } });
  woId = wo.id;
  const zimpara = wo.steps[0].id;

  // ── 409 MULTI_BATCH: P1 + P2 birlikte, strateji yok ──
  const p1 = await attachWave(ITEM, GRADE, ADMIN, 2);
  const p2 = await attachWave(ITEM, GRADE, ADMIN, 2);
  // NEDEN adlandırılmış tip (`typeof err` DEĞİL): `typeof err` catch bloğunda akış
  // daraltmasına tabidir — o noktada `err`'e yalnız `null` atanmış olduğu için
  // `typeof err` = `null`'a iner, yani `e as typeof err` fiilen `e as null` olur.
  // Sonuç: aşağıdaki üç kontrol `never` üzerinde çalışır ve 409 gövdesi
  // (code/batches) derleme tarafında HİÇ doğrulanmaz. Runtime'da JS umursamadığı
  // için test yeşil kalıyordu — tam da bu görevin aradığı sessiz iptal.
  type MultiBatchErr = { message: string; details?: { code?: string; batches?: { batchNumber: string; oldest: boolean }[] } };
  let err: MultiBatchErr | null = null;
  try {
    await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimpara, rollIds: [...p1.rollIds, ...p2.rollIds] }, ADMIN);
  } catch (e) { err = e as MultiBatchErr; }
  check("çok-parti + stratejisiz → 409", !!err && err.message.includes("birden fazla partiden"), err?.message ?? "hata yok");
  check("409 payload code=MULTI_BATCH", err?.details?.code === "MULTI_BATCH", err?.details?.code);
  check("409 payload en eski parti işaretli", !!err?.details?.batches?.find((b) => b.oldest), JSON.stringify(err?.details?.batches?.map((b) => `${b.batchNumber}:${b.oldest}`)));

  // ── MERGE: P1 + P2 birlikte → en eski (P1) survivor ──
  const merge = await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimpara, rollIds: [...p1.rollIds, ...p2.rollIds], multiBatchStrategy: "MERGE" }, ADMIN);
  const dispBatchId = (merge.data as { batchId: string }).batchId;
  check("MERGE: sevk survivor P1'de (en eski)", dispBatchId === p1.batchId, `dispatch.batchId=P1? ${dispBatchId === p1.batchId}`);
  const p1Rolls = await prisma.roll.count({ where: { batchId: p1.batchId, status: RollStatus.AT_SUBCONTRACTOR } });
  check("MERGE: 4 top survivor'da + AT_SUBCONTRACTOR", p1Rolls === 4, `p1Rolls=${p1Rolls}`);
  check("MERGE: kaynak P2 silindi (izsiz boş)", (await prisma.batch.findUnique({ where: { id: p2.batchId }, select: { id: true } })) === null);

  // ── SEPARATE: P3 + P4 birlikte → 2 ayrı sevk ──
  const p3 = await attachWave(ITEM, GRADE, ADMIN, 2);
  const p4 = await attachWave(ITEM, GRADE, ADMIN, 2);
  const sep = await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimpara, rollIds: [...p3.rollIds, ...p4.rollIds], multiBatchStrategy: "SEPARATE" }, ADMIN);
  check("SEPARATE: separate=true", (sep.data as { separate?: boolean }).separate === true);
  check("SEPARATE: 2 ayrı sevk", (sep.data as { dispatchCount?: number }).dispatchCount === 2, `count=${(sep.data as { dispatchCount?: number }).dispatchCount}`);
  const p3disp = await prisma.subcontractorDispatch.count({ where: { batchId: p3.batchId } });
  const p4disp = await prisma.subcontractorDispatch.count({ where: { batchId: p4.batchId } });
  check("SEPARATE: P3 ve P4 kendi sevkini aldı", p3disp === 1 && p4disp === 1, `P3=${p3disp} P4=${p4disp}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const batches = await prisma.batch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ batchId: { in: batchIds } }, { barcode: { startsWith: "TST-K11-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: woId } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, woId, ...batchIds] } } });
    await prisma.workOrder.delete({ where: { id: woId } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
