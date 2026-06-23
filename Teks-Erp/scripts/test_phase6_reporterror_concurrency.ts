// =============================================================================
// TEST: Faz 6 — RollError mükerrer-hata EŞZAMANLILIK guard'ı (partial unique)
// Çalıştır: npx tsx scripts/test_phase6_reporterror_concurrency.ts
// =============================================================================
// migration 20260623100000: roll_errors(rollId,startMeter,defectTypeId) WHERE
// defectTypeId IS NOT NULL → PARTIAL UNIQUE. tambur/KK2 reportError P2002→409.
//   A) Sıralı: aynı top+metre+tip 2. kez → 409; farklı metre serbest.
//   B) FLAGSHIP eşzamanlılık: 2 paralel reportError → tam 1 başarı + tam 1×409
//      VE DB'de TEK RollError kalır (unique olmadan ikisi de findFirst'ü geçip
//      2 satır yazardı — count===1 partial unique'in fiilen çalıştığını kanıtlar).
// =============================================================================

import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { AppError } from "../src/utils/app-error";
import { WorkOrderStatus, RollStatus, StationKind } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}
const is409 = (e: unknown) => e instanceof AppError && e.statusCode === 409;

const tambur = new TamburService();
let ITEM = "",
  GRADE = "",
  ADMIN = "",
  STATION_TAMBUR = "",
  DEFECT = "";
const woIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION_TAMBUR = need(await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } }), "TAMBUR").id;
  DEFECT = need(await prisma.defectType.findFirst({ where: { isActive: true }, select: { id: true } }), "DefectType").id;
}

async function makeTamburRoll(): Promise<{ rollId: string; stepId: string }> {
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-P6-WO-${woIds.length}-${Date.now().toString().slice(-5)}`,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      width: 150,
      targetQuantity: 100,
      targetItemId: ITEM,
      steps: { create: [{ stationId: STATION_TAMBUR, stepSequence: 1, status: "PENDING" as const }] },
    },
    include: { steps: true },
  });
  woIds.push(wo.id);
  const stepId = wo.steps[0].id;
  const roll = await prisma.roll.create({
    data: {
      barcode: `TST-P6-R-${woIds.length}-${Date.now().toString().slice(-5)}`,
      itemId: ITEM,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.IN_PRODUCTION,
      qualityGrade: "1.KALITE",
      qualityGradeId: GRADE,
      width: 150,
      createdById: ADMIN,
      currentStepId: stepId,
    },
  });
  return { rollId: roll.id, stepId };
}

async function testSequential(): Promise<void> {
  console.log("\n=== A) Sıralı mükerrer (findFirst pre-check) ===");
  const { rollId, stepId } = await makeTamburRoll();
  const r1 = await tambur.reportError({ rollId, stepId, startMeter: 10, defectTypeId: DEFECT }, ADMIN);
  check("ilk kayıt: success", r1.success === true);
  let dup: unknown;
  try {
    await tambur.reportError({ rollId, stepId, startMeter: 10, defectTypeId: DEFECT }, ADMIN);
  } catch (e) {
    dup = e;
  }
  check("sıralı aynı top+metre+tip → 409", is409(dup));
  const r3 = await tambur.reportError({ rollId, stepId, startMeter: 20, defectTypeId: DEFECT }, ADMIN);
  check("farklı metre serbest", r3.success === true);
}

async function testConcurrent(): Promise<void> {
  console.log("\n=== B) EŞZAMANLI çift-tık (partial unique) ===");
  const { rollId, stepId } = await makeTamburRoll();
  const settled = await Promise.allSettled([
    tambur.reportError({ rollId, stepId, startMeter: 15, defectTypeId: DEFECT }, ADMIN),
    tambur.reportError({ rollId, stepId, startMeter: 15, defectTypeId: DEFECT }, ADMIN),
  ]);
  const ok = settled.filter((s) => s.status === "fulfilled").length;
  const conflict = settled.filter((s) => s.status === "rejected" && is409((s as PromiseRejectedResult).reason)).length;
  check("paralel reportError: tam 1 başarılı", ok === 1, `ok=${ok}`);
  check("paralel reportError: tam 1 × 409", conflict === 1, `409=${conflict}`);
  const count = await prisma.rollError.count({ where: { rollId, startMeter: 15, defectTypeId: DEFECT } });
  check("eşzamanlı çift → DB'de TEK RollError (partial unique fiilen çalıştı)", count === 1, `count=${count}`);
}

async function cleanup(): Promise<void> {
  const rolls = await prisma.roll.findMany({ where: { barcode: { startsWith: "TST-P6-R-" } }, select: { id: true } });
  const rollIds = rolls.map((r) => r.id);
  await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await testSequential();
    await testConcurrent();
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
