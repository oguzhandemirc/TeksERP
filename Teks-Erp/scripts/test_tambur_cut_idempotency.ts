// =============================================================================
// TEST: Tambur kesim idempotency (clientChildBarcode) — backlog #3
// Çalıştır: npx tsx scripts/test_tambur_cut_idempotency.ts
// =============================================================================
// cutWarehouseRoll / cutOpenFabric: clientChildBarcode verilince ağ-retry'ında
// child @unique P2002 → tx geri sarılır (ikinci decrement YOK) → mevcut child
// idempotent döner. createInitialEntry.clientBarcode deseni.
//   A) cutWarehouseRoll sıralı retry → 1 child, parent 1 kez düşülür.
//   B) cutWarehouseRoll EŞZAMANLI (2 paralel aynı barkod) → 1 child, 1 decrement.
//   C) cutOpenFabric sıralı retry → 1 child, 1 decrement.
//   D) clientChildBarcode YOK (server-üretimi) → idempotency yok (opt-in kanıtı).
// =============================================================================

import { v4 as uuidv4 } from "uuid";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
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

const tambur = new TamburService();
let ITEM = "",
  GRADE = "",
  ADMIN = "",
  COLOR = "",
  STATION_TAMBUR = "";
const woIds: string[] = [];
const parentIds: string[] = [];
let seq = 0;
const tok = () => uuidv4(); // idempotency anahtarı (barkod artık sunucu-atanan)

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  COLOR = need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "renk").id;
  STATION_TAMBUR = need(await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } }), "TAMBUR").id;
}

async function warehouseRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `TST-TCI-${seq++}-${Date.now().toString().slice(-5)}`,
      itemId: ITEM, colorId: COLOR, status: RollStatus.WAREHOUSE,
      currentQty: qty, initialQty: qty, width: 150,
      qualityGrade: "1.KALITE", qualityGradeId: GRADE, createdById: ADMIN,
    },
    select: { id: true },
  });
  parentIds.push(r.id);
  return r.id;
}

async function openFabricRoll(qty: number): Promise<string> {
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-TCI-WO-${woIds.length}-${Date.now().toString().slice(-5)}`,
      type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, width: 150, targetItemId: ITEM,
      steps: { create: [{ stationId: STATION_TAMBUR, stepSequence: 1, status: "ACTIVE" as const }] },
    },
    include: { steps: true },
  });
  woIds.push(wo.id);
  const r = await prisma.roll.create({
    data: {
      barcode: null, itemId: ITEM, colorId: COLOR, status: RollStatus.IN_PRODUCTION,
      currentQty: qty, initialQty: qty, width: 150,
      qualityGrade: "1.KALITE", qualityGradeId: GRADE, createdById: ADMIN,
      currentStepId: wo.steps[0].id, entrySource: "SUBCONTRACTOR_RETURN",
    },
    select: { id: true },
  });
  parentIds.push(r.id);
  return r.id;
}

const qtyOf = async (id: string) => Number(need(await prisma.roll.findUnique({ where: { id }, select: { currentQty: true } }), "roll").currentQty);
const childCountByToken = (t: string) => prisma.roll.count({ where: { clientToken: t } });

async function run(): Promise<void> {
  // A) cutWarehouseRoll sıralı retry
  console.log("\n=== A) cutWarehouseRoll sıralı retry idempotency ===");
  const w1 = await warehouseRoll(100);
  const b1 = tok();
  await tambur.cutWarehouseRoll(w1, { cutLength: 30, clientToken: b1 }, ADMIN);
  await tambur.cutWarehouseRoll(w1, { cutLength: 30, clientToken: b1 }, ADMIN); // retry
  check("retry: tek child (barkod 1×)", (await childCountByToken(b1)) === 1);
  check("retry: parent 1 kez düşüldü (100→70)", (await qtyOf(w1)) === 70, `qty=${await qtyOf(w1)}`);

  // B) cutWarehouseRoll EŞZAMANLI
  console.log("\n=== B) cutWarehouseRoll eşzamanlı (2 paralel, aynı barkod) ===");
  const w2 = await warehouseRoll(100);
  const b2 = tok();
  const settled = await Promise.allSettled([
    tambur.cutWarehouseRoll(w2, { cutLength: 30, clientToken: b2 }, ADMIN),
    tambur.cutWarehouseRoll(w2, { cutLength: 30, clientToken: b2 }, ADMIN),
  ]);
  check("paralel: ikisi de hata vermedi (1 fresh + 1 idempotent)", settled.every((s) => s.status === "fulfilled"));
  check("paralel: tek child", (await childCountByToken(b2)) === 1);
  check("paralel: parent 1 kez düşüldü (100→70)", (await qtyOf(w2)) === 70, `qty=${await qtyOf(w2)}`);

  // C) cutOpenFabric sıralı retry
  console.log("\n=== C) cutOpenFabric sıralı retry idempotency ===");
  const o1 = await openFabricRoll(100);
  const b3 = tok();
  await tambur.cutOpenFabric(o1, { lengthMeters: 30, status: "WAREHOUSE", clientToken: b3 }, ADMIN);
  await tambur.cutOpenFabric(o1, { lengthMeters: 30, status: "WAREHOUSE", clientToken: b3 }, ADMIN); // retry
  check("openfabric retry: tek child", (await childCountByToken(b3)) === 1);
  check("openfabric retry: parent 1 kez düşüldü (100→70)", (await qtyOf(o1)) === 70, `qty=${await qtyOf(o1)}`);

  // D) clientToken YOK → idempotency YOK (opt-in / geriye uyum kanıtı)
  console.log("\n=== D) clientToken'sız → server-üretimi, idempotency YOK ===");
  const w3 = await warehouseRoll(100);
  await tambur.cutWarehouseRoll(w3, { cutLength: 30 }, ADMIN);
  await tambur.cutWarehouseRoll(w3, { cutLength: 30 }, ADMIN);
  check("anahtarsız: 2 ayrı kesim (parent 100→40)", (await qtyOf(w3)) === 40, `qty=${await qtyOf(w3)}`);
  const w3children = await prisma.roll.count({ where: { parentRollId: w3 } });
  check("anahtarsız: 2 child (server barkod, idempotency yok)", w3children === 2, `children=${w3children}`);
}

async function cleanup(): Promise<void> {
  await prisma.rollOperation.deleteMany({ where: { roll: { parentRollId: { in: parentIds } } } }).catch(() => undefined);
  await prisma.roll.deleteMany({ where: { parentRollId: { in: parentIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: parentIds } } }).catch(() => undefined);
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: parentIds } } }).catch(() => undefined);
  await prisma.roll.deleteMany({ where: { id: { in: parentIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await run();
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
