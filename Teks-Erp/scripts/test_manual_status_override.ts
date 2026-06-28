// =============================================================================
// TEST: Manuel durum düzeltme — kısıtlı whitelist + invariant guard
// Çalıştır: npx tsx scripts/test_manual_status_override.ts
// =============================================================================
// Kapsam (PR-2):
//   1) İzinli geçişler: WAREHOUSE→STOCK, STOCK→WAREHOUSE, PRODUCED→WAREHOUSE.
//   2) Yasak hedef: STOCK→IN_PRODUCTION → red. Yasak kaynak: AT_SUBCONTRACTOR → red.
//   3) Invariant: currentStepId dolu (istasyonda aktif) → preview engelli + override 409.
//   4) Preview: temiz WAREHOUSE → allowedTargets=[STOCK], blockReasons=[].
//   5) Boş sebep → red.
// =============================================================================

import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { RollStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); check(label, false, "hata bekleniyordu, atılmadı"); }
  catch { check(label, true); }
}

const inv = new InventoryService();
let ITEM = "", GRADE = "", ADMIN = "", ST_KURSUN = "";
const rollIds: string[] = [];
const woIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-STA-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
}

async function makeRoll(status: RollStatus, currentStepId: string | null = null): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(), itemId: ITEM, initialQty: 100, currentQty: 100,
      status, qualityGrade: "1.KALITE", qualityGradeId: GRADE, createdById: ADMIN,
      currentStepId,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function makeStep(): Promise<string> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-STA-${stamp}`, type: "STOCK_PRODUCTION", status: "PLANNED",
      targetQuantity: 100, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_KURSUN, stepSequence: 1, status: "PENDING" as const }] },
    },
    include: { steps: true },
  });
  woIds.push(wo.id);
  return wo.steps[0].id;
}

async function statusOf(id: string): Promise<RollStatus> {
  return (await prisma.roll.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    console.log("\n=== 1) İzinli geçişler ===");
    const rWh = await makeRoll(RollStatus.WAREHOUSE);
    await inv.manualStatusOverride(rWh, { targetStatus: RollStatus.STOCK, reason: "depo→stok geri çek" }, ADMIN);
    check("WAREHOUSE→STOCK", await statusOf(rWh) === RollStatus.STOCK);

    const rStock = await makeRoll(RollStatus.STOCK);
    await inv.manualStatusOverride(rStock, { targetStatus: RollStatus.WAREHOUSE, reason: "stok→depo sevke hazır" }, ADMIN);
    check("STOCK→WAREHOUSE", await statusOf(rStock) === RollStatus.WAREHOUSE);

    const rProd = await makeRoll(RollStatus.PRODUCED);
    await inv.manualStatusOverride(rProd, { targetStatus: RollStatus.WAREHOUSE, reason: "üretildi→depo" }, ADMIN);
    check("PRODUCED→WAREHOUSE", await statusOf(rProd) === RollStatus.WAREHOUSE);

    console.log("\n=== 2) Yasak geçişler ===");
    const rStock2 = await makeRoll(RollStatus.STOCK);
    await expectThrow("STOCK→IN_PRODUCTION yasak", () =>
      inv.manualStatusOverride(rStock2, { targetStatus: RollStatus.IN_PRODUCTION, reason: "yasak" }, ADMIN));
    const rSub = await makeRoll(RollStatus.AT_SUBCONTRACTOR);
    await expectThrow("AT_SUBCONTRACTOR kaynak yasak", () =>
      inv.manualStatusOverride(rSub, { targetStatus: RollStatus.STOCK, reason: "yasak" }, ADMIN));
    const subPreview = await inv.getStatusOverridePreview(rSub);
    check("AT_SUBCONTRACTOR preview: allowedTargets boş", subPreview.data.allowedTargets.length === 0);

    console.log("\n=== 3) Invariant: istasyonda aktif (currentStepId) ===");
    const stepId = await makeStep();
    const rActive = await makeRoll(RollStatus.WAREHOUSE, stepId);
    const activePreview = await inv.getStatusOverridePreview(rActive);
    check("aktif top preview: blockReasons dolu", activePreview.data.blockReasons.length > 0);
    check("aktif top preview: allowedTargets boş", activePreview.data.allowedTargets.length === 0);
    await expectThrow("aktif top override → 409", () =>
      inv.manualStatusOverride(rActive, { targetStatus: RollStatus.STOCK, reason: "aktif" }, ADMIN));

    console.log("\n=== 4) Temiz preview ===");
    const rClean = await makeRoll(RollStatus.WAREHOUSE);
    const cleanPreview = await inv.getStatusOverridePreview(rClean);
    check("temiz WAREHOUSE: allowedTargets=[STOCK]",
      cleanPreview.data.allowedTargets.length === 1 && cleanPreview.data.allowedTargets[0] === RollStatus.STOCK);
    check("temiz WAREHOUSE: blockReasons boş", cleanPreview.data.blockReasons.length === 0);

    console.log("\n=== 5) Boş sebep ===");
    const rNoReason = await makeRoll(RollStatus.WAREHOUSE);
    await expectThrow("boş sebep → red", () =>
      inv.manualStatusOverride(rNoReason, { targetStatus: RollStatus.STOCK, reason: "" }, ADMIN));
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
  await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
