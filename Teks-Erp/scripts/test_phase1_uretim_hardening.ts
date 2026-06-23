// =============================================================================
// TEST: Faz 1 — Üretim domain sertleştirme
// Çalıştır: npx tsx scripts/test_phase1_uretim_hardening.ts
// =============================================================================
// Kapsam:
//   A) softDelete ATOMİK CLAIM (MED) — FLAGSHIP eşzamanlılık kanıtı:
//      Aynı WO'ya iki PARALEL softDelete → tam olarak BİRİ başarılı (CANCELLED),
//      BİRİ 409. Eski koddaki bare update({where:{id}}) ikisini de "başarılı"
//      kabul ederdi (check-then-act). + happy-path (PLANNED→CANCELLED) korunur.
//   B) Terminal-durum reddi (softDelete/update terminal WO; hardDelete IN_PROGRESS)
//      → 409 (refactor sonrası reddetme davranışı korunuyor).
//   C) Tambur.reportError mükerrer guard'ı (KK2 paritesi): aynı top+metre+tip
//      ikinci kez → 409 DUPLICATE_ROLL_ERROR; farklı metre serbest.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
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
function is409(e: unknown): boolean {
  return e instanceof AppError && e.statusCode === 409;
}

const wos = new WorkOrderService();
const tambur = new TamburService();
const WIDTH = 150;

let ITEM = "",
  GRADE = "",
  ADMIN = "",
  STATION_ANY = "",
  STATION_TAMBUR = "",
  DEFECT = "";
const woIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  GRADE = need(
    await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }),
    "QualityGrade 1.KALITE"
  ).id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION_ANY = need(
    await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }),
    "Station BOYA_FASON"
  ).id;
  STATION_TAMBUR = need(
    await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } }),
    "Station kind=TAMBUR"
  ).id;
  DEFECT = need(
    await prisma.defectType.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif DefectType"
  ).id;
}

let woSeq = 0;
async function makeWo(
  stationId: string,
  status: WorkOrderStatus = WorkOrderStatus.PLANNED
): Promise<{ woId: string; stepId: string }> {
  woSeq += 1;
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-P1-${woSeq}-${woIds.length}-${STATION_ANY.slice(0, 4)}${woSeq}`,
      type: "STOCK_PRODUCTION",
      status,
      width: WIDTH,
      targetQuantity: 100,
      targetItemId: ITEM,
      steps: { create: [{ stationId, stepSequence: 1, status: "PENDING" as const }] },
    },
    include: { steps: true },
  });
  woIds.push(wo.id);
  return { woId: wo.id, stepId: wo.steps[0].id };
}

// ── A) softDelete atomik claim ───────────────────────────────────────────────
async function testSoftDeleteClaim(): Promise<void> {
  console.log("\n=== A) softDelete atomik claim (MED) ===");

  // happy path
  const { woId } = await makeWo(STATION_ANY);
  const res = await wos.softDelete(woId, ADMIN);
  check("softDelete happy: success", res.success === true);
  const after = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
  check("softDelete happy: WO.status=CANCELLED", after?.status === WorkOrderStatus.CANCELLED);

  // FLAGSHIP: iki paralel softDelete → tam 1 başarı + tam 1 409
  const { woId: w2 } = await makeWo(STATION_ANY);
  const settled = await Promise.allSettled([wos.softDelete(w2, ADMIN), wos.softDelete(w2, ADMIN)]);
  const okCount = settled.filter((r) => r.status === "fulfilled").length;
  const conflictCount = settled.filter(
    (r) => r.status === "rejected" && is409((r as PromiseRejectedResult).reason)
  ).length;
  check("paralel softDelete: tam olarak 1 başarılı", okCount === 1, `ok=${okCount}`);
  check("paralel softDelete: tam olarak 1 × 409 (claim kazananı serileştirdi)", conflictCount === 1, `409=${conflictCount}`);
  const w2after = await prisma.workOrder.findUnique({ where: { id: w2 }, select: { status: true } });
  check("paralel softDelete: son durum CANCELLED", w2after?.status === WorkOrderStatus.CANCELLED);
}

// ── B) Terminal-durum reddi ──────────────────────────────────────────────────
async function testTerminalRejection(): Promise<void> {
  console.log("\n=== B) Terminal-durum reddi ===");

  const { woId: done } = await makeWo(STATION_ANY, WorkOrderStatus.COMPLETED);
  let softErr: unknown;
  try {
    await wos.softDelete(done, ADMIN);
  } catch (e) {
    softErr = e;
  }
  check("softDelete(COMPLETED) → 409", is409(softErr));

  let updErr: unknown;
  try {
    await wos.update(done, { dyehouseNote: "x" }, ADMIN);
  } catch (e) {
    updErr = e;
  }
  check("update(COMPLETED) → 409", is409(updErr));

  const { woId: inprog } = await makeWo(STATION_ANY, WorkOrderStatus.IN_PROGRESS);
  let hardErr: unknown;
  try {
    await wos.hardDelete(inprog, ADMIN);
  } catch (e) {
    hardErr = e;
  }
  check("hardDelete(IN_PROGRESS) → 409", is409(hardErr));
}

// ── C) Tambur.reportError mükerrer guard ─────────────────────────────────────
async function testTamburDuplicateError(): Promise<void> {
  console.log("\n=== C) Tambur.reportError mükerrer guard (KK2 paritesi) ===");

  const { stepId } = await makeWo(STATION_TAMBUR, WorkOrderStatus.IN_PROGRESS);
  const roll = await prisma.roll.create({
    data: {
      barcode: `TST-P1-R-${woSeq}-${Date.now().toString().slice(-5)}`,
      itemId: ITEM,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.IN_PRODUCTION,
      qualityGrade: "1.KALITE",
      qualityGradeId: GRADE,
      width: WIDTH,
      createdById: ADMIN,
      currentStepId: stepId,
    },
  });

  const r1 = await tambur.reportError(
    { rollId: roll.id, stepId, startMeter: 10, defectTypeId: DEFECT },
    ADMIN
  );
  check("reportError ilk kayıt: success", r1.success === true);

  let dupErr: unknown;
  try {
    await tambur.reportError({ rollId: roll.id, stepId, startMeter: 10, defectTypeId: DEFECT }, ADMIN);
  } catch (e) {
    dupErr = e;
  }
  check("reportError aynı top+metre+tip → 409", is409(dupErr));
  const details = dupErr instanceof AppError ? (dupErr.details as { code?: string } | undefined) : undefined;
  check("reportError mükerrer kodu DUPLICATE_ROLL_ERROR", details?.code === "DUPLICATE_ROLL_ERROR", details?.code ?? "yok");

  // farklı metre serbest (aynı top, farklı startMeter)
  const r3 = await tambur.reportError(
    { rollId: roll.id, stepId, startMeter: 25, defectTypeId: DEFECT },
    ADMIN
  );
  check("reportError farklı metre serbest", r3.success === true);
}

async function cleanup(): Promise<void> {
  const rolls = await prisma.roll.findMany({ where: { barcode: { startsWith: "TST-P1-" } }, select: { id: true } });
  const rollIds = rolls.map((r) => r.id);
  await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await testSoftDeleteClaim();
    await testTerminalRejection();
    await testTamburDuplicateError();
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
