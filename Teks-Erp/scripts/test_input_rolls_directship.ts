// =============================================================================
// TEST: "Üretime Giren" (inputRolls) SAYIMI fasondan-sevk kısmi split çocuğuyla ŞİŞMEZ.
// Çalıştır: npx tsx scripts/test_input_rolls_directship.ts
// =============================================================================
// Regresyon (workorder.service.ts findById inputRolls):
//   Fason İLK adım + KISMİ metrajlı fasondan-sevk → sevk metresi için ÇOCUK roll
//   doğar (ilk adımda kalıcı RollMovement açılır + sonra SUBCONTRACTOR_CONSUMED).
//   inputRolls "A klozu" (ilk adıma movement'ı olanlar) çocuğu da sayarsa count =
//   orijinal + çocuk olur → BUG: her kısmi sevk sayıyı +1 şişirir (yan panelde
//   "9 top" gibi). Fix: getBatchTimeline ile AYNI ayraç (parentRollId &&
//   directShipmentId) çocuğu SAYIMdan eler; METRAJ korunur (kalan + çocuk = charge).
// =============================================================================

import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

const svc = new WorkOrderService();
const sub = new SubcontractorService();
const cards = new TravelerCardService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_TAMBUR = "", SUB_BOYER = "", CUSTOMER = "";
const WIDTH = 250;
const woIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-IRD-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001");
}

async function inputOf(woId: string): Promise<{ meters: number; count: number }> {
  const res = await svc.findById(woId);
  const ir = (((res.data ?? {}) as Record<string, unknown>).inputRolls ?? {}) as { totalMeters?: unknown; count?: unknown };
  return { meters: Number(ir.totalMeters ?? 0), count: Number(ir.count ?? 0) };
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    console.log("\n=== Fason ilk adım + KISMİ metrajlı fasondan-sevk: inputRolls count şişmez ===");
    const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-IRD-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
        width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
        steps: { create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" as const },
          { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" as const },
        ] },
      },
      include: { steps: { orderBy: { stepSequence: "asc" } } },
    });
    woIds.push(wo.id);
    await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
    const step1 = wo.steps[0].id;

    // Serbest stok top → doğrudan fason sevk (dispatch auto-attach: currentStepId=step1
    // + ilk adımda IN movement açar). Attach ayrı adım gerekmez.
    const roll = await prisma.roll.create({
      data: {
        barcode: barcode(), itemId: ITEM, initialQty: 300, currentQty: 300,
        status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE,
        width: WIDTH, createdById: ADMIN,
      },
    });
    const d = await sub.dispatch({ workOrderId: wo.id, stepId: step1, subcontractorId: SUB_BOYER, rollIds: [roll.id] }, ADMIN);
    const dId = (d.data as { id: string }).id;

    // Sevk ÖNCESİ baz çizgisi: tek orijinal top, 300 m.
    const before = await inputOf(wo.id);
    check("sevk öncesi inputRolls: 1 top / 300 m", before.count === 1 && before.meters === 300, `count=${before.count} m=${before.meters}`);

    // 300'ün 100'ünü müşteriye KISMİ sevk et → 100'lük çocuk doğar (consumed),
    // orijinal 200 m'ye iner ve fasonda kalır.
    await sub.executeDirectShip(
      { dispatchId: dId, reason: "kısmi metraj split regresyon", customerId: CUSTOMER, rollIds: [roll.id], rollShipQtys: { [roll.id]: 100 } },
      ADMIN,
    );

    const child = await prisma.roll.findFirst({
      where: { parentRollId: roll.id, directShipmentId: { not: null } },
      select: { initialQty: true, status: true },
    });
    check("kısmi split çocuğu doğdu (100 m, consumed)",
      child != null && Number(child.initialQty) === 100 && child.status === RollStatus.SUBCONTRACTOR_CONSUMED,
      `child=${child ? Number(child.initialQty) + "m/" + child.status : "yok"}`);

    // KRİTİK: sayım şişmemeli (çocuk sayılmamalı), metraj korunmalı.
    const after = await inputOf(wo.id);
    check("kısmi sevk SONRASI inputRolls.count=1 (fasondan-sevk çocuğu SAYILMAZ)", after.count === 1, `count=${after.count}`);
    check("inputRolls.totalMeters=300 (charge korunur: 200 kalan + 100 çocuk)", after.meters === 300, `m=${after.meters}`);
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
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    // Split çocukları currentStepId=null + "H" barkod → OR'a düşmez; parentRollId ile yakala.
    const rolls = await prisma.roll.findMany({
      where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { barcode: { startsWith: "TST-IRD-" } }] },
      select: { id: true },
    });
    const baseRollIds = rolls.map((r) => r.id);
    const children = await prisma.roll.findMany({
      where: { parentRollId: { in: baseRollIds }, directShipmentId: { not: null } },
      select: { id: true },
    });
    const rollIds = [...baseRollIds, ...children.map((r) => r.id)];

    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...woIds] } } });
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    // DirectShipment.dispatchId onDelete:Restrict → dispatch'ten ÖNCE sil.
    await prisma.directShipment.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
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

main().catch(async (e) => {
  console.error("HATA:", e);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});
