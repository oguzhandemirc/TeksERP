// =============================================================================
// TEST: Faz 3 — Stok/Roll sertleştirme
// Çalıştır: npx tsx scripts/test_phase3_stok_hardening.ts
// =============================================================================
// Kapsam:
//   A) Relabel (applyManualProperties) qualityGrade KATALOG doğrulaması + FK senkron:
//      bilinmeyen kod → 400; geçerli kod → snapshot string + qualityGradeId FK BİRLİKTE.
//   B) lockWorkOrder ATOMİK CLAIM: iki paralel kilitle → tam 1 başarı + tam 1×409.
// =============================================================================

import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { InventoryService } from "../src/services/inventory.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { AppError } from "../src/utils/app-error";
import { WorkOrderStatus } from "@prisma/client";

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
const is400 = (e: unknown) => e instanceof AppError && e.statusCode === 400;

const inv = new InventoryService();
const wos = new WorkOrderService();

let ITEM = "",
  ADMIN = "",
  COLOR = "",
  GRADE_1 = "",
  GRADE_2 = "",
  STATION = "";
let GRADE_1_CODE = "";
let GRADE_2_CODE = "";
const woIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  const firstRow = await roleGrade("FIRST");
  GRADE_1 = firstRow.id;
  GRADE_1_CODE = firstRow.code;
  // Relabel hedefi: topun MEVCUT kodundan farklı, GEÇERLİ bir katalog kodu.
  const secondRow = await roleGrade("SECOND");
  GRADE_2 = secondRow.id;
  GRADE_2_CODE = secondRow.code;
  STATION = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  // PATOS izinli renk (liste boşsa = sınırsız → herhangi aktif renk).
  const allowed = await prisma.itemAllowedColor.findFirst({ where: { itemId: ITEM }, select: { colorId: true } });
  COLOR = allowed
    ? allowed.colorId
    : need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "aktif renk").id;
}

// ── A) Relabel qualityGrade katalog + FK ─────────────────────────────────────
async function testRelabelQuality(): Promise<void> {
  console.log("\n=== A) Relabel qualityGrade katalog doğrulama + FK senkron ===");
  const roll = await prisma.roll.create({
    data: {
      barcode: `TST-P3-R-${Date.now().toString().slice(-6)}`,
      itemId: ITEM,
      colorId: COLOR,
      status: "WAREHOUSE",
      currentQty: 100,
      initialQty: 100,
      width: 150,
      qualityGrade: GRADE_1_CODE,
      qualityGradeId: GRADE_1,
      entrySource: "SUPPLIER_RECEIPT",
    },
  });

  let badErr: unknown;
  try {
    await inv.applyManualProperties(
      roll.id,
      { colorId: COLOR, propertyIds: [], width: 150, qualityGrade: "ZZZ-YOK" },
      ADMIN
    );
  } catch (e) {
    badErr = e;
  }
  check("relabel bilinmeyen kalite kodu → 400", is400(badErr));

  await inv.applyManualProperties(
    roll.id,
    { colorId: COLOR, propertyIds: [], width: 150, qualityGrade: GRADE_2_CODE },
    ADMIN
  );
  const after = await prisma.roll.findUnique({
    where: { id: roll.id },
    select: { qualityGrade: true, qualityGradeId: true },
  });
  check(`relabel geçerli kod → snapshot '${GRADE_2_CODE}'`, after?.qualityGrade === GRADE_2_CODE);
  check("relabel → qualityGradeId FK senkron", after?.qualityGradeId === GRADE_2, after?.qualityGradeId ?? "null");

  await prisma.roll.deleteMany({ where: { id: roll.id } });
}

// ── B) lockWorkOrder atomik claim ────────────────────────────────────────────
async function makePlannedWo(): Promise<string> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-P3-WO-${woIds.length}-${Date.now().toString().slice(-5)}`,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.PLANNED,
      width: 150,
      targetQuantity: 100,
      targetItemId: ITEM,
      steps: { create: [{ stationId: STATION, stepSequence: 1, status: "PENDING" as const }] },
    },
  });
  woIds.push(wo.id);
  return wo.id;
}

async function testLockClaim(): Promise<void> {
  console.log("\n=== B) lockWorkOrder atomik claim ===");
  const w1 = await makePlannedWo();
  const r = await wos.lockWorkOrder(w1, ADMIN);
  check("lock happy: success", r.success === true);
  const a1 = await prisma.workOrder.findUnique({ where: { id: w1 }, select: { status: true } });
  check("lock happy: IN_PROGRESS", a1?.status === WorkOrderStatus.IN_PROGRESS);

  const w2 = await makePlannedWo();
  const settled = await Promise.allSettled([wos.lockWorkOrder(w2, ADMIN), wos.lockWorkOrder(w2, ADMIN)]);
  const ok = settled.filter((s) => s.status === "fulfilled").length;
  const conflict = settled.filter((s) => s.status === "rejected" && is409((s as PromiseRejectedResult).reason)).length;
  check("paralel lock: tam 1 başarılı", ok === 1, `ok=${ok}`);
  check("paralel lock: tam 1 × 409 (claim)", conflict === 1, `409=${conflict}`);
}

async function cleanup(): Promise<void> {
  await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.roll.deleteMany({ where: { barcode: { startsWith: "TST-P3-R-" } } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await testRelabelQuality();
    await testLockClaim();
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
