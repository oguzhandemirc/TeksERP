// =============================================================================
// TEST: Fason sevk atomik claim'i step-eşleşme + autoAttach steal guard
//       (feat/wo-input-at-attach — Değişiklik 1)
// Çalıştır: npx tsx scripts/test_dispatch_claim_step_match.ts
// =============================================================================
// Kapsam:
//   1) Başka WO/adıma bağlı (IN_PRODUCTION) top, bir başka adımın sevkine
//      okutulursa reddedilir (ön-döngü + claim currentStepId guard).
//   2) autoAttach steal: aynı SERBEST stok topu iki paralel sevke (iki farklı WO)
//      okutulursa TAM BİRİ kazanır, diğeri 409; top yalnız BİR WO'da kalır.
//   3) Aynı bağlı top, aynı adıma iki paralel sevk → biri kazanır, diğeri 409
//      (claim count guard); top tam bir kez AT_SUBCONTRACTOR.
// =============================================================================

import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const svc = new WorkOrderService();
const sub = new SubcontractorService();
const cards = new TravelerCardService();

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", SUB_BOYER = "";
const WIDTH = 250;
const woIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-CLM-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
}

async function makeStockRoll(qty: number): Promise<{ id: string; barcode: string }> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code, itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE,
      width: WIDTH, createdById: ADMIN,
    },
    select: { id: true },
  });
  return { id: r.id, barcode: code };
}

async function makeWoBoya(): Promise<{ woId: string; stepId: string }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-CLM-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING" as const }] },
    },
    include: { steps: true },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return { woId: wo.id, stepId: wo.steps[0].id };
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === 1) Başka adıma bağlı top, farklı adımın sevkine reddedilir ===
    console.log("\n=== 1) Başka adıma bağlı top farklı sevke reddedilir ===");
    {
      const X = await makeWoBoya();
      const r = await makeStockRoll(100);
      await svc.attachRolls(X.woId, [r.barcode], ADMIN); // r.currentStepId = X.stepId
      const Y = await makeWoBoya();
      let rejected = false;
      try {
        await sub.dispatch({ workOrderId: Y.woId, stepId: Y.stepId, subcontractorId: SUB_BOYER, rollIds: [r.id] }, ADMIN);
      } catch (e) {
        rejected = true;
        check("reddetme mesajı 'bu adımda değil/farklı adıma'", /adımda değil|farklı bir adıma/i.test(e instanceof Error ? e.message : ""), (e instanceof Error ? e.message : "").slice(0, 70));
      }
      check("başka adıma bağlı top Y sevkine giremez", rejected);
      const rr = await prisma.roll.findUnique({ where: { id: r.id }, select: { currentStepId: true, status: true } });
      check("top hâlâ X'te, AT_SUBCONTRACTOR'a kaçmadı", rr?.currentStepId === X.stepId && rr?.status === RollStatus.IN_PRODUCTION, `cs=${rr?.currentStepId === X.stepId ? "X" : rr?.currentStepId} st=${rr?.status}`);
    }

    // === 2) autoAttach steal: aynı serbest top, iki paralel sevk (iki WO) ===
    console.log("\n=== 2) autoAttach steal yarışı ===");
    {
      const A = await makeWoBoya();
      const B = await makeWoBoya();
      const r = await makeStockRoll(100); // serbest stok
      const results = await Promise.allSettled([
        sub.dispatch({ workOrderId: A.woId, stepId: A.stepId, subcontractorId: SUB_BOYER, rollIds: [r.id] }, ADMIN),
        sub.dispatch({ workOrderId: B.woId, stepId: B.stepId, subcontractorId: SUB_BOYER, rollIds: [r.id] }, ADMIN),
      ]);
      const ok = results.filter((x) => x.status === "fulfilled").length;
      const no = results.filter((x) => x.status === "rejected").length;
      check("autoAttach steal: tam BİRİ kazandı (diğeri 409)", ok === 1 && no === 1, `ok=${ok} no=${no}`);
      const rr = await prisma.roll.findUnique({ where: { id: r.id }, select: { currentStepId: true, status: true } });
      const inOneWo = rr?.currentStepId === A.stepId || rr?.currentStepId === B.stepId;
      check("top yalnız BİR WO'da, AT_SUBCONTRACTOR", inOneWo && rr?.status === RollStatus.AT_SUBCONTRACTOR, `cs=${rr?.currentStepId} st=${rr?.status}`);
    }

    // === 3) Aynı bağlı top, aynı adıma iki paralel sevk (claim count guard) ===
    console.log("\n=== 3) Aynı bağlı top aynı adıma iki paralel sevk ===");
    {
      const C = await makeWoBoya();
      const r = await makeStockRoll(100);
      await svc.attachRolls(C.woId, [r.barcode], ADMIN); // IN_PRODUCTION @ C.stepId
      const results = await Promise.allSettled([
        sub.dispatch({ workOrderId: C.woId, stepId: C.stepId, subcontractorId: SUB_BOYER, rollIds: [r.id] }, ADMIN),
        sub.dispatch({ workOrderId: C.woId, stepId: C.stepId, subcontractorId: SUB_BOYER, rollIds: [r.id] }, ADMIN),
      ]);
      const ok = results.filter((x) => x.status === "fulfilled").length;
      const no = results.filter((x) => x.status === "rejected").length;
      check("aynı top çift sevk: biri kazandı, biri 409", ok === 1 && no === 1, `ok=${ok} no=${no}`);
      const rr = await prisma.roll.findUnique({ where: { id: r.id }, select: { status: true } });
      check("top tam bir kez AT_SUBCONTRACTOR", rr?.status === RollStatus.AT_SUBCONTRACTOR, `st=${rr?.status}`);
      const dispItems = await prisma.subcontractorDispatchItem.count({ where: { rollId: r.id } });
      check("top yalnız 1 dispatch item'a girdi", dispItems === 1, `items=${dispItems}`);
    }
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function cleanup(): Promise<void> {
  const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const stepIdSet = steps.map((s) => s.id);
  const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const dispatchIds = dispatches.map((d) => d.id);
  const rolls = await prisma.roll.findMany({
    where: { OR: [{ barcode: { startsWith: "TST-CLM-" } }, { currentStepId: { in: stepIdSet } }, { producedInStepId: { in: stepIdSet } }] },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { OR: [{ dispatchId: { in: dispatchIds } }, { rollId: { in: rollIds } }] } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...woIds] } } });
  const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cardRows.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIdSet } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
