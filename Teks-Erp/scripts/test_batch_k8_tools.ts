// TEST (Faz 4.2 / K8): parti düzeltme araçları — moveRolls / splitBatch / mergeBatches.
//   Yalnız SEVKSİZ (kilitsiz) partide çalışır; sevkli partide 409. Birleşmede EN ESKİ no yaşar.
// Çalıştır: npx tsx scripts/test_batch_k8_tools.ts
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { moveRolls, mergeBatches, splitBatch } from "../src/services/batch.service";
import { RollStatus } from "@prisma/client";

const WIDTH = 250;
const wos = new WorkOrderService();
const sub = new SubcontractorService();
let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void { if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); } else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); } }
async function expectReject(l: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  let m: string | null = null;
  try { await fn(); } catch (e) { m = e instanceof Error ? e.message : String(e); }
  check(l, m !== null && m.includes(needle), m ?? "hata atılmadı");
}
let bcN = 0;
function bc(): string { bcN++; return `TST-K8-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bcN}`; }
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
  const SUB = need(await prisma.subcontractor.findFirst({ where: { code: "KESTEL" }, select: { id: true } }), "KESTEL");

  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TST-K8-${stamp}`, type: "STOCK_PRODUCTION", status: "PLANNED", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB }] } },
    include: { steps: true } });
  woId = wo.id;
  const zimpara = wo.steps[0].id;

  const p1 = await attachWave(ITEM, GRADE, ADMIN, 4); // P1: 4 top
  const p2 = await attachWave(ITEM, GRADE, ADMIN, 3); // P2: 3 top
  check("iki dalga iki ayrı parti", p1.batchId !== p2.batchId);

  // ── moveRolls: P2'den 1 top → P1 ──
  await moveRolls({ rollIds: [p2.rollIds[0]], toBatchId: p1.batchId, userId: ADMIN });
  const moved = await prisma.roll.findUnique({ where: { id: p2.rollIds[0] }, select: { batchId: true } });
  check("moveRolls: top P1'e taşındı", moved?.batchId === p1.batchId);
  check("moveRolls: P1=5 top", (await prisma.roll.count({ where: { batchId: p1.batchId } })) === 5);
  check("moveRolls: P2=2 top", (await prisma.roll.count({ where: { batchId: p2.batchId } })) === 2);

  // ── splitBatch: P1'den 2 top → yeni P3 ──
  const split = await splitBatch({ batchId: p1.batchId, rollIds: [p1.rollIds[0], p1.rollIds[1]], userId: ADMIN });
  check("splitBatch: yeni parti P ile başlar", split.newBatchNumber.startsWith("P"), split.newBatchNumber);
  const p3row = await prisma.batch.findUnique({ where: { id: split.newBatchId }, select: { splitFromId: true } });
  check("splitBatch: P3 splitFrom=P1", p3row?.splitFromId === p1.batchId);
  check("splitBatch: P3=2 top", (await prisma.roll.count({ where: { batchId: split.newBatchId } })) === 2);
  check("splitBatch: yeni kart ÜRETİLMEZ (kart WO başına)", (await prisma.travelerCard.count({ where: { workOrderId: woId } })) === 0);
  check("splitBatch: P1=3 top kaldı", (await prisma.roll.count({ where: { batchId: p1.batchId } })) === 3);

  // ── mergeBatches: P1 + P3 → EN ESKİ (P1) yaşar ──
  const merge = await mergeBatches({ batchIds: [split.newBatchId, p1.batchId], userId: ADMIN });
  check("mergeBatches: survivor=P1 (en eski no yaşar)", merge.survivorId === p1.batchId, `survivor=${merge.survivorNumber}`);
  check("mergeBatches: P1=5 top (P3 geri döndü)", (await prisma.roll.count({ where: { batchId: p1.batchId } })) === 5);
  check("mergeBatches: P3 silindi (izsiz boş kaynak)", (await prisma.batch.findUnique({ where: { id: split.newBatchId }, select: { id: true } })) === null);

  // ── Lock guard: P2'yi sevk et → kilitli → araçlar 409 ──
  await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimpara, rollIds: p2.rollIds.slice(1) }, ADMIN);
  await expectReject("kilitli hedef partiye moveRolls → 409", () => moveRolls({ rollIds: [p1.rollIds[2]], toBatchId: p2.batchId, userId: ADMIN }), "sevk edilmiş");
  await expectReject("kilitli parti mergeBatches → 409", () => mergeBatches({ batchIds: [p2.batchId, p1.batchId], userId: ADMIN }), "sevk edilmiş");
  await expectReject("kilitli parti splitBatch → 409", () => splitBatch({ batchId: p2.batchId, rollIds: [p2.rollIds[1]], userId: ADMIN }), "sevk edilmiş");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const batches = await prisma.batch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ batchId: { in: batchIds } }, { barcode: { startsWith: "TST-K8-" } }] }, select: { id: true } });
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
