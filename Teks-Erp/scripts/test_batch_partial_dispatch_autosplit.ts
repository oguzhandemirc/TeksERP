// TEST (Faz 3.1 / K5): Kısmi fason sevkte OTO-BÖL.
//   Sevke GİREN toplar orijinal partiyi (P1) + kartını korur; sevke GİRMEYEN kalan
//   toplar YENİ partiye (P2, splitFrom=P1) + YENİ karta ayrılır. Sevkin partisi = P1.
// Çalıştır: npx tsx scripts/test_batch_partial_dispatch_autosplit.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestSander } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { RollStatus } from "@prisma/client";

const WIDTH = 250;
const sub = new SubcontractorService();
const wos = new WorkOrderService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
let bc = 0;
function barcode(): string { bc++; return `TST-K5-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

let woId = "";

async function main(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const _gradeRow = await roleGrade("FIRST");
  const GRADE = _gradeRow.id;
  const GRADE_CODE = _gradeRow.code;
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  const SUB_KESTEL = (await ensureTestSander()).id;

  const stamp = `${Date.now()}`.slice(-6);
  // İlk adım EXTERNAL (zımpara fason). attach sonrası toplar IN_PRODUCTION @ zimpara, parti P1.
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-K5-${stamp}`, type: "STOCK_PRODUCTION", status: "PLANNED",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB_KESTEL }] },
    },
    include: { steps: true },
  });
  woId = wo.id;
  const zimparaStep = wo.steps[0].id;

  const bcs = [barcode(), barcode(), barcode()];
  for (const b of bcs) {
    await prisma.roll.create({ data: { barcode: b, itemId: ITEM, initialQty: 300, currentQty: 300, status: RollStatus.STOCK, qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  }

  // attachRolls → parti P1 + kart RK1 doğar
  const attach = await wos.attachRolls(woId, bcs, ADMIN);
  check("attach 3 top bağladı", attach.data!.attached === 3, `attached=${attach.data!.attached}`);
  const p1Id = attach.data!.batch?.id ?? "";
  check("attach parti P1 doğurdu", !!attach.data!.batch?.batchNumber?.startsWith("P"), `P1=${attach.data!.batch?.batchNumber}`);

  const rolls0 = await prisma.roll.findMany({ where: { barcode: { in: bcs } }, select: { id: true, barcode: true, batchId: true } });
  check("3 top da P1'e bağlı", rolls0.every((r) => r.batchId === p1Id));
  const byBc = new Map(rolls0.map((r) => [r.barcode, r.id]));
  const r1 = byBc.get(bcs[0])!, r2 = byBc.get(bcs[1])!, r3 = byBc.get(bcs[2])!;

  // Kısmi sevk: r1, r2 → fason; r3 sevke girmez (kalan)
  const res = await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimparaStep, rollIds: [r1, r2] }, ADMIN);
  const dispatchId = (res.data as { id: string }).id;
  const remainderBatch = (res.data as { remainderBatch?: { id: string; batchNumber: string } }).remainderBatch;

  const after = await prisma.roll.findMany({ where: { id: { in: [r1, r2, r3] } }, select: { id: true, status: true, batchId: true } });
  const g = (id: string) => after.find((r) => r.id === id)!;
  check("r1 AT_SUBCONTRACTOR + P1 korundu", g(r1).status === RollStatus.AT_SUBCONTRACTOR && g(r1).batchId === p1Id, `${g(r1).status}/${g(r1).batchId === p1Id}`);
  check("r2 AT_SUBCONTRACTOR + P1 korundu", g(r2).status === RollStatus.AT_SUBCONTRACTOR && g(r2).batchId === p1Id);
  check("r3 sevke girmedi → YENİ partiye ayrıldı (P2 ≠ P1)", g(r3).batchId !== null && g(r3).batchId !== p1Id, `r3.batchId≠P1=${g(r3).batchId !== p1Id}`);
  check("yanıt remainderBatch taşıyor", !!remainderBatch?.id && remainderBatch.id === g(r3).batchId, `remainder=${remainderBatch?.batchNumber}`);

  const p2Id = g(r3).batchId!;
  const p2 = await prisma.batch.findUnique({ where: { id: p2Id }, select: { batchNumber: true, splitFromId: true } });
  check("P2 soy bağı P1'e (splitFrom)", p2?.splitFromId === p1Id, `splitFrom=P1? ${p2?.splitFromId === p1Id}`);
  check("P2 no P ile başlar", !!p2?.batchNumber?.startsWith("P"), `P2=${p2?.batchNumber}`);

  // NOT: Eski model her partiye ("dal") ayrı refakat kartı verirdi; autosplit P1→P2'de
  // "P1 kartını korur, P2 yeni kart alır" assert edilirdi. Kart-iş-emriyle redesign'ıyla
  // kart artık PARTİ başına DEĞİL, İŞ EMRİ başına doğar (TravelerCard.workOrderId @unique,
  // batchId alanı yok) — parti autosplit'i kart yaratmaz/kopyalamaz. Bu test WO'yu doğrudan
  // prisma ile (servis-dışı) kurduğundan kart hiç doğmaz; kart-doğuş/tek-kart invariantı
  // ayrıca test_traveler_print_active_card'da kapsanır. Buradaki eski kart-per-parti
  // assertion'ları KALDIRILDI (test kapsamı = autosplit soy bağı, kart değil).

  const disp = await prisma.subcontractorDispatch.findUnique({ where: { id: dispatchId }, select: { batchId: true } });
  check("Sevkin partisi = P1 (giden), kalan P2 değil", disp?.batchId === p1Id, `dispatch.batchId=P1? ${disp?.batchId === p1Id}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const batches = await prisma.batch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ batchId: { in: batchIds } }, { barcode: { startsWith: "TST-K5-" } }] }, select: { id: true } });
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
