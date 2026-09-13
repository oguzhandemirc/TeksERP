// =============================================================================
// TEST: "Üretime giren" sayımı attach anına çekildi (feat/wo-input-at-attach)
// Çalıştır: npx tsx scripts/test_wo_input_attach_window.ts
// =============================================================================
// Kapsam (Değişiklik 2 — birleşik sayım: A=ilk-adım movement ∪ B=currentStepId=ilk adım,
// guard: currentStepId null VEYA bu WO'nun adımı):
//   1) EXTERNAL (boyahane) ilk adım: attach SONRASI committed/inputRolls = Σ initialQty
//      (sevk EDİLMEDEN). Eski bug: 0 görünüyordu.
//   2) Dispatch sonrası DEĞİŞMEZ (çift sayım yok — distinct rollId).
//   3) Receive sonrası DEĞİŞMEZ: orijinal bir kez sayılır; born (açık-kumaş) roll
//      IN_PRODUCTION olsa da SAYILMAZ (currentStepId=sonraki adım, ilk-adıma movement yok).
//   4) INTERNAL ilk adım: bugünkü davranışla AYNI (attach'te movement yazılır).
//   5) autoAttach (serbest stok doğrudan fason sevk): committed/inputRolls dolu.
// =============================================================================

import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { computeWoMaterial } from "../src/services/helpers/coverage.helper";
import { RollStatus } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const svc = new WorkOrderService();
const sub = new SubcontractorService();
const cards = new TravelerCardService();

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_KURSUN = "", SUB_BOYER = "";
let GRADE_CODE = "";
const WIDTH = 250;
const woIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-INP-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

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
  SUB_BOYER = (await ensureTestDyeHouse()).id;
}

async function makeStockRoll(qty: number): Promise<{ id: string; barcode: string }> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code, itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(), qualityGrade: GRADE_CODE, qualityGradeId: GRADE,
      width: WIDTH, createdById: ADMIN,
    },
    select: { id: true },
  });
  return { id: r.id, barcode: code };
}

async function makeWo(stepDefs: { stationId: string; seq: number }[]): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-INP-${stamp}`, type: "STOCK_PRODUCTION", status: "PLANNED",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: stepDefs.map((s) => ({ stationId: s.stationId, stepSequence: s.seq, status: "PENDING" as const })) },
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
async function inputOf(woId: string): Promise<{ meters: number; count: number }> {
  const res = await svc.findById(woId);
  const data = (res.data ?? {}) as Record<string, unknown>;
  const ir = (data.inputRolls ?? {}) as { totalMeters?: unknown; count?: unknown };
  return { meters: Number(ir.totalMeters ?? 0), count: Number(ir.count ?? 0) };
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === 1-3) EXTERNAL ilk adım (Boyahane → Kurşun) ===
    console.log("\n=== EXTERNAL ilk adım: attach → dispatch → receive ===");
    {
      const { woId, stepIds } = await makeWo([{ stationId: ST_BOYA, seq: 1 }, { stationId: ST_KURSUN, seq: 2 }]);
      const r1 = await makeStockRoll(100);
      const r2 = await makeStockRoll(200);
      await svc.attachRolls(woId, [r1.barcode, r2.barcode], ADMIN);

      // 1) attach penceresi — sevk YOK
      check("EXTERNAL attach: committed=300 (sevksiz)", await committedOf(woId) === 300, `committed=${await committedOf(woId)}`);
      const inp1 = await inputOf(woId);
      check("EXTERNAL attach: inputRolls=300m / 2 top", inp1.meters === 300 && inp1.count === 2, `m=${inp1.meters} c=${inp1.count}`);

      // 2) dispatch — değişmez
      await sub.dispatch({ workOrderId: woId, stepId: stepIds[0], subcontractorId: SUB_BOYER, rollIds: [r1.id, r2.id] }, ADMIN);
      check("EXTERNAL dispatch sonrası: committed=300 (çift değil)", await committedOf(woId) === 300, `committed=${await committedOf(woId)}`);
      check("EXTERNAL dispatch sonrası: inputRolls=300m", (await inputOf(woId)).meters === 300);

      // 3) receive — orijinal bir kez, born SAYILMAZ
      await sub.receive({
        workOrderId: woId, stepId: stepIds[0], subcontractorId: SUB_BOYER,
        returns: [{ rollId: r1.id }, { rollId: r2.id }], newRolls: [{ qty: 280 }],
      } as Parameters<typeof sub.receive>[0], ADMIN);
      const born = await prisma.roll.findFirst({
        where: { producedInStepId: stepIds[0], entrySource: "SUBCONTRACTOR_RETURN" },
        select: { status: true, currentStepId: true, initialQty: true },
      });
      check("receive: born roll IN_PRODUCTION + currentStepId=sonraki adım (gerçek non-STOCK)",
        born?.status === RollStatus.IN_PRODUCTION && born?.currentStepId === stepIds[1],
        `status=${born?.status} cs=${born?.currentStepId === stepIds[1] ? "next" : born?.currentStepId}`);
      check("receive sonrası: committed=300 (born 280 SAYILMADI)", await committedOf(woId) === 300, `committed=${await committedOf(woId)}`);
      check("receive sonrası: inputRolls=300m / 2 top", (await inputOf(woId)).meters === 300 && (await inputOf(woId)).count === 2);
    }

    // === 4) INTERNAL ilk adım — bugünkü davranış (attach'te movement) ===
    console.log("\n=== INTERNAL ilk adım: attach ===");
    {
      const { woId } = await makeWo([{ stationId: ST_KURSUN, seq: 1 }]);
      const a1 = await makeStockRoll(50);
      const a2 = await makeStockRoll(50);
      await svc.attachRolls(woId, [a1.barcode, a2.barcode], ADMIN);
      check("INTERNAL attach: committed=100", await committedOf(woId) === 100, `committed=${await committedOf(woId)}`);
      check("INTERNAL attach: inputRolls=100m / 2 top", (await inputOf(woId)).meters === 100 && (await inputOf(woId)).count === 2);
    }

    // === 5) autoAttach — serbest stok doğrudan fason sevk ===
    console.log("\n=== autoAttach: serbest stok doğrudan sevk ===");
    {
      const { woId, stepIds } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
      const r = await makeStockRoll(120); // attach YOK — dispatch auto-attach edecek
      await sub.dispatch({ workOrderId: woId, stepId: stepIds[0], subcontractorId: SUB_BOYER, rollIds: [r.id] }, ADMIN);
      check("autoAttach: committed=120", await committedOf(woId) === 120, `committed=${await committedOf(woId)}`);
      check("autoAttach: inputRolls=120m", (await inputOf(woId)).meters === 120);
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
  const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const receiptIds = receipts.map((r) => r.id);
  const rolls = await prisma.roll.findMany({
    where: {
      OR: [
        { barcode: { startsWith: "TST-INP-" } },
        { currentStepId: { in: stepIdSet } },
        { producedInStepId: { in: stepIdSet } },
        { parentReceiptId: { in: receiptIds } },
      ],
    },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ. Bu test fason
  // kabulü yapıyor ve 2026-08-21'den beri giden↔dönen metraj farkı da deftere
  // yazılıyor (SUBCONTRACTOR_RETURN); satır silinmeden `roll.deleteMany` 23001
  // ile düşer ve temizlik yarıda kalır (arkasında hayalet movement bırakır).
  await prisma.rollVariance.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIdSet } }] } });
  await prisma.subcontractorReceiptItem.deleteMany({ where: { OR: [{ receiptId: { in: receiptIds } }, { newRollId: { in: rollIds } }] } });
  await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
  await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
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
