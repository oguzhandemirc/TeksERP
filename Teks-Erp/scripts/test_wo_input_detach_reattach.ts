// =============================================================================
// TEST: detach→reattach bayat-sayım kusuru düzeltildi (feat/wo-input-at-attach)
// Çalıştır: npx tsx scripts/test_wo_input_detach_reattach.ts
// =============================================================================
// Kapsam (Değişiklik 3 — sayaç guard'ı: currentStepId null VEYA bu WO'nun adımı):
//   1) detach (ilk adımda) → başka WO'ya reattach: eski WO committed=0, yeni WO=Σ.
//      (Eski bug: eski WO append-only ilk-adım movement'ı yüzünden saymaya devam ederdi.)
//   2) İLERLEMİŞ-detach simülasyonu: ilk-adım movement'i KAPALI + notes≠DETACHED iken
//      reattach → guard yine eski WO'yu 0'da tutar (notes-filtresi bu vakayı KAÇIRIRDI).
//   3) EXTERNAL ilk adımda sevk-öncesi detach → eski WO committed=0.
// =============================================================================

import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { WorkOrderService } from "../src/services/workorder.service";
import { workOrderRollDetachService } from "../src/services/workorder-roll-detach.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { computeWoMaterial } from "../src/services/helpers/coverage.helper";
import { RollStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const svc = new WorkOrderService();
const cards = new TravelerCardService();

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_KURSUN = "";
let GRADE_CODE = "";
const WIDTH = 250;
const woIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-DET-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
}

async function makeStockRoll(qty: number): Promise<{ id: string; barcode: string }> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code, itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, qualityGrade: GRADE_CODE, qualityGradeId: GRADE,
      width: WIDTH, createdById: ADMIN,
    },
    select: { id: true },
  });
  return { id: r.id, barcode: code };
}

async function makeWo(stationId: string): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-DET-${stamp}`, type: "STOCK_PRODUCTION", status: "PLANNED",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId, stepSequence: 1, status: "PENDING" as const }] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return { woId: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

async function committedOf(woId: string): Promise<number> {
  const m = await computeWoMaterial(prisma, [woId]);
  return Number(m.get(woId)?.committed ?? 0);
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === 1) detach (ilk adımda) → başka WO'ya reattach (INTERNAL) ===
    console.log("\n=== 1) detach → reattach (INTERNAL ilk adım) ===");
    {
      const X = await makeWo(ST_KURSUN);
      const r = await makeStockRoll(100);
      await svc.attachRolls(X.woId, [r.barcode], ADMIN);
      check("X attach: committed=100", await committedOf(X.woId) === 100, `committed=${await committedOf(X.woId)}`);

      await workOrderRollDetachService.detachRoll(X.woId, r.id, "bekçi: yanlış okutma", ADMIN);
      check("X detach sonrası: committed=0", await committedOf(X.woId) === 0, `committed=${await committedOf(X.woId)}`);

      const Y = await makeWo(ST_KURSUN);
      await svc.attachRolls(Y.woId, [r.barcode], ADMIN);
      check("Y reattach: X committed=0 (bayat movement saymıyor — GUARD)", await committedOf(X.woId) === 0, `X=${await committedOf(X.woId)}`);
      check("Y reattach: Y committed=100", await committedOf(Y.woId) === 100, `Y=${await committedOf(Y.woId)}`);
    }

    // === 2) İLERLEMİŞ-detach simülasyonu: kapalı + notes≠DETACHED ilk-adım movement ===
    // Top ilk adımı geçip ilerlerse ilk-adım movement'ı KAPALI ve notes'u DETACHED
    // DEĞİLDİR. Bu durumu doğrudan kurarak guard'ın notes'tan BAĞIMSIZ çalıştığını
    // (yani currentStepId temelli olduğunu) kanıtlıyoruz — notes-filtresi KAÇIRIRDI.
    console.log("\n=== 2) İlerlemiş-detach simülasyonu (notes≠DETACHED) → reattach ===");
    {
      const X2 = await makeWo(ST_KURSUN);
      const r2 = await makeStockRoll(100);
      await svc.attachRolls(X2.woId, [r2.barcode], ADMIN); // M1 açık @ X2.fs
      // İlerleme + WO'dan ayrılma simülasyonu: M1'i DETACHED OLMAYAN bir notla kapat,
      // topu serbest stoka düşür (Top Çıkar çağırmadan — onun izi oluşmasın).
      await prisma.rollMovement.updateMany({
        where: { rollId: r2.id, workOrderStepId: X2.stepIds[0] },
        data: { exitedAt: new Date(), notes: "ADVANCE_SIM" },
      });
      await prisma.roll.update({ where: { id: r2.id }, data: { status: RollStatus.STOCK, currentStepId: null, producedInStepId: null } });

      const Y2 = await makeWo(ST_KURSUN);
      await svc.attachRolls(Y2.woId, [r2.barcode], ADMIN);
      check("X2 (ilerlemiş-detach): committed=0 (guard notes'tan bağımsız)", await committedOf(X2.woId) === 0, `X2=${await committedOf(X2.woId)}`);
      check("Y2 reattach: committed=100", await committedOf(Y2.woId) === 100, `Y2=${await committedOf(Y2.woId)}`);
    }

    // === 3) EXTERNAL ilk adımda sevk-öncesi detach ===
    console.log("\n=== 3) EXTERNAL ilk adımda sevk-öncesi detach ===");
    {
      const X3 = await makeWo(ST_BOYA);
      const r3 = await makeStockRoll(100);
      await svc.attachRolls(X3.woId, [r3.barcode], ADMIN); // movement YOK, currentStepId=Boyahane (B_set)
      check("X3 attach (EXTERNAL): committed=100", await committedOf(X3.woId) === 100, `committed=${await committedOf(X3.woId)}`);
      await workOrderRollDetachService.detachRoll(X3.woId, r3.id, "bekçi: sevk öncesi çıkarma", ADMIN);
      check("X3 detach sonrası: committed=0", await committedOf(X3.woId) === 0, `committed=${await committedOf(X3.woId)}`);
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
  const rolls = await prisma.roll.findMany({
    where: { OR: [{ barcode: { startsWith: "TST-DET-" } }, { currentStepId: { in: stepIdSet } }, { producedInStepId: { in: stepIdSet } }] },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cardRows.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIdSet } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
