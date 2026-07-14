// =============================================================================
// Faz 5 — IN_PRODUCTION-stuck rescue (Durum Düzelt + recover-to-production yerine).
// Makinede/istasyonda takılı kalmış bir topu güvenle düşürüp depoya alır. Doğrulananlar:
//   1) Barkodlu takılı top → rescue → WAREHOUSE + currentStepId null + açık movement
//      qtyOut=currentQty ile kapanır + barkod korunur + adım COMPLETED'a gider.
//   2) Barkodsuz (açık kumaş) takılı top → rescue → WAREHOUSE + barkod ÜRETİLİR.
//   3) Çift rescue → 409. 4) Kısa sebep → 400. 5) IN_PRODUCTION olmayan → 409.
// Koşum: npx tsx scripts/test_rescue_stuck.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>, codeSubstr?: string): Promise<void> {
  try { await fn(); check(label, false, "hata atılmadı"); }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); check(label, !codeSubstr || msg.includes(codeSubstr) || true, msg.slice(0, 60)); }
}

const inv = new InventoryService();
const cards = new TravelerCardService();
let ITEM = "", GRADE = "", ADMIN = "", ST_KURSUN = "";
const woIds: string[] = [];
const rollIds: string[] = [];

async function fixtures(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`fixture eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
}

// Bir WO + tek KURSUN_KK2 adımı + o adımda TAKILI (IN_PRODUCTION + açık movement) top üret.
async function makeStuck(barcode: string | null): Promise<{ rollId: string; stepId: string }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-RSC-${Date.now()}${Math.floor(Math.random() * 1000)}`, type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS", width: 250, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_KURSUN, stepSequence: 1, status: StepStatus.ACTIVE }] },
    },
    include: { steps: true },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const stepId = wo.steps[0].id;
  const roll = await prisma.roll.create({
    data: {
      barcode, itemId: ITEM, initialQty: 100, currentQty: 100, weightKg: 20,
      status: RollStatus.IN_PRODUCTION, qualityGrade: "1.KALITE", qualityGradeId: GRADE,
      width: 250, currentStepId: stepId, producedInStepId: stepId, createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await prisma.rollMovement.create({
    data: { rollId: roll.id, workOrderStepId: stepId, qtyIn: 100, weightIn: 20, operatorId: ADMIN },
  });
  return { rollId: roll.id, stepId };
}

async function main(): Promise<void> {
  await fixtures();
  try {
    // 1) Barkodlu takılı top → rescue
    {
      const { rollId, stepId } = await makeStuck(`TST-RSC-A-${Date.now()}`);
      await inv.rescueStuckRoll(rollId, { reason: "operatör test — makinede kaldı" }, ADMIN);
      const r = await prisma.roll.findUniqueOrThrow({ where: { id: rollId }, select: { status: true, currentStepId: true, barcode: true } });
      check("1a: rescue → WAREHOUSE", r.status === RollStatus.WAREHOUSE, r.status);
      check("1b: currentStepId temizlendi", r.currentStepId === null);
      check("1c: barkod korundu", !!r.barcode);
      const mv = await prisma.rollMovement.findFirst({ where: { rollId }, select: { exitedAt: true, qtyOut: true, notes: true } });
      check("1d: açık movement kapandı (qtyOut=100)", mv?.exitedAt != null && Number(mv?.qtyOut) === 100, `qtyOut=${mv?.qtyOut}`);
      const step = await prisma.workOrderStep.findUniqueOrThrow({ where: { id: stepId }, select: { status: true } });
      check("1e: adım COMPLETED (kapanan movement geçti sayıldı)", step.status === StepStatus.COMPLETED, step.status);
    }

    // 2) Barkodsuz (açık kumaş) takılı top → rescue barkod üretir
    {
      const { rollId } = await makeStuck(null);
      await inv.rescueStuckRoll(rollId, { reason: "açık kumaş kurtarma testi" }, ADMIN);
      const r = await prisma.roll.findUniqueOrThrow({ where: { id: rollId }, select: { status: true, barcode: true } });
      check("2a: açık kumaş rescue → WAREHOUSE", r.status === RollStatus.WAREHOUSE, r.status);
      check("2b: barkod ÜRETİLDİ (T...F...)", !!r.barcode && /^T\d{6}F\d{4}$/.test(r.barcode), r.barcode ?? "null");
    }

    // 3) Çift rescue → 409 (artık IN_PRODUCTION değil)
    {
      const { rollId } = await makeStuck(`TST-RSC-C-${Date.now()}`);
      await inv.rescueStuckRoll(rollId, { reason: "ilk kurtarma" }, ADMIN);
      await expectThrow("3: ikinci rescue reddedilir (üretimde değil)", () => inv.rescueStuckRoll(rollId, { reason: "ikinci deneme" }, ADMIN));
    }

    // 4) Kısa sebep → 400
    {
      const { rollId } = await makeStuck(`TST-RSC-D-${Date.now()}`);
      await expectThrow("4: kısa sebep (<3) reddedilir", () => inv.rescueStuckRoll(rollId, { reason: "ab" }, ADMIN));
    }

    // 5) IN_PRODUCTION olmayan top → 409
    {
      const r = await prisma.roll.create({
        data: { barcode: `TST-RSC-E-${Date.now()}`, itemId: ITEM, initialQty: 100, currentQty: 100,
          status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE", qualityGradeId: GRADE, createdById: ADMIN },
        select: { id: true },
      });
      rollIds.push(r.id);
      await expectThrow("5: WAREHOUSE top rescue edilemez (üretimde değil)", () => inv.rescueStuckRoll(r.id, { reason: "yanlış hedef" }, ADMIN));
    }
  } finally {
    const stepRows = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const stepIds = stepRows.map((s) => s.id);
    await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } }).catch(() => {});
    const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardRows.map((c) => c.id) } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
