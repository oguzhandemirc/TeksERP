// =============================================================================
// TEST: İş emri MANUEL KAPATMA (güvenli varyant) — completeWorkOrder + preview.
// Çalıştır: npx tsx scripts/test_wo_manual_complete.ts
// =============================================================================
//   A) TEMİZ KAPAT: WIP yok (top depoya çözülmüş) → preview.canComplete=true,
//      completeWorkOrder → WO COMPLETED, kalan adımlar SKIPPED(MANUAL_COMPLETE).
//   B) WIP BLOK: top hâlâ işlemde (IN_PRODUCTION, currentStepId=adım) →
//      preview.canComplete=false, completeWorkOrder 409 fırlatır, WO IN_PROGRESS kalır.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";

const svc = new WorkOrderService();
const cards = new TravelerCardService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>, msgPart?: string): Promise<void> {
  let err: string | null = null;
  try { await fn(); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  check(label, err !== null && (!msgPart || err.includes(msgPart)), err ?? "(hata YOK!)");
}

let ITEM = "", GRADE = "", ADMIN = "", ST_KURSUN = "", ST_TAMBUR = "";
const WIDTH = 250;
const woIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-MCL-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
}

async function makeWo(): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-MCL-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_KURSUN, stepSequence: 1, status: "PENDING" as const },
        { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" as const },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return { woId: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

async function stockRoll(qty: number): Promise<{ id: string; barcode: string }> {
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

type Preview = { canComplete: boolean; blockReason: string | null; remainingSteps: unknown[]; inFlight: { count: number } };
async function previewOf(woId: string): Promise<Preview> {
  return (await svc.getCompletePreview(woId)).data as unknown as Preview;
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === A) TEMİZ KAPAT (WIP yok) ===
    console.log("\n=== A) Temiz kapat: WIP yok → COMPLETED, kalan adımlar SKIPPED ===");
    {
      const { woId, stepIds } = await makeWo();
      const roll = await stockRoll(300);
      await svc.attachRolls(woId, [roll.barcode], ADMIN); // roll IN_PRODUCTION @ step1
      // Topu depoya çöz (finalize simülasyonu) → artık in-flight değil.
      await prisma.roll.update({
        where: { id: roll.id },
        data: { status: RollStatus.WAREHOUSE, currentStepId: null, producedInStepId: stepIds[0] },
      });

      const pv = await previewOf(woId);
      check("preview.canComplete=true (WIP yok)", pv.canComplete === true, `block=${pv.blockReason}`);
      check("preview.remainingSteps=2", pv.remainingSteps.length === 2, `n=${pv.remainingSteps.length}`);

      await svc.completeWorkOrder(woId, ADMIN);
      const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      check("WO COMPLETED", wo?.status === WorkOrderStatus.COMPLETED, String(wo?.status));
      const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: woId }, select: { status: true, skipReason: true } });
      check("kalan adımlar SKIPPED(MANUAL_COMPLETE)",
        steps.every((s) => s.status === StepStatus.SKIPPED && s.skipReason === "MANUAL_COMPLETE"),
        steps.map((s) => `${s.status}/${s.skipReason}`).join(", "));
    }

    // === B) WIP BLOK ===
    console.log("\n=== B) WIP blok: top işlemde → reddedilir, WO IN_PROGRESS kalır ===");
    {
      const { woId } = await makeWo();
      const roll = await stockRoll(200);
      await svc.attachRolls(woId, [roll.barcode], ADMIN); // roll IN_PRODUCTION @ step1 (in-flight)

      const pv = await previewOf(woId);
      check("preview.canComplete=false", pv.canComplete === false);
      check("preview.inFlight.count=1", pv.inFlight.count === 1, `n=${pv.inFlight.count}`);

      await expectThrow("completeWorkOrder → 409 (işlemde top)", () => svc.completeWorkOrder(woId, ADMIN), "işlemde");
      const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      check("WO hâlâ IN_PROGRESS (guard rollback)", wo?.status === WorkOrderStatus.IN_PROGRESS, String(wo?.status));
    }
  } finally {
    await cleanup();
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function cleanup(): Promise<void> {
  try {
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { barcode: { startsWith: "TST-MCL-" } }] },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const cardIds = cardRows.map((c) => c.id);
    await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main().catch(async (e) => { console.error("HATA:", e); await cleanup(); await prisma.$disconnect(); process.exit(1); });
