// =============================================================================
// TEST: Faz 0 — çapraz dayanıklılık/perf hızlı kazanımları
// Çalıştır: npx tsx scripts/test_phase0_quickwins.ts
// =============================================================================
// Kapsam (gerçek regresyon riski olan mantık değişiklikleri):
//   A) AuditService.logMany — N entry TEK createMany ile yazılır; boş dizi no-op;
//      category=DOMAIN, userId undefined→null. (WO iliştir/çıkar + Tambur child
//      audit'leri artık buradan geçiyor.)
//   B) order.getCancelPreview — N+1 giderildikten SONRA gruplama doğruluğu:
//      otherOrdersCount/otherOrderNumbers (woId→Set) + producedRollCount (groupBy)
//      + isSoleOrder. Bir WO iki siparişe, başka WO tek siparişe bağlı senaryo.
//
// Not: server.ts process handler'ları ve app.ts /health backup cache'i modül
// seviyesinde/yan-etkili olduğundan burada birim test edilmez (tsc + manuel).
// =============================================================================

import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { AuditService } from "../src/services/audit.service";
import { RollStatus } from "@prisma/client";

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

const orderService = new OrderService({ modelName: "order", tableName: "ORDER" });
const WIDTH = 150;

let ITEM = "",
  GRADE = "",
  CUSTOMER = "",
  ADMIN = "",
  STATION = "";
const orderIds: string[] = [];
const woIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  GRADE = need(
    await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }),
    "QualityGrade 1.KALITE"
  ).id;
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION = need(
    await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }),
    "Station BOYA_FASON"
  ).id;
}

// ── A) AuditService.logMany ──────────────────────────────────────────────────
async function testLogMany(): Promise<void> {
  console.log("\n=== A) AuditService.logMany ===");
  const before = await prisma.systemLog.count({ where: { tableName: "TEST-PHASE0" } });
  await AuditService.logMany([
    { userId: ADMIN, action: "UPDATE", tableName: "TEST-PHASE0", recordId: "TEST-r1", oldData: { a: 1 }, newData: { a: 2 } },
    { userId: ADMIN, action: "CREATE", tableName: "TEST-PHASE0", recordId: "TEST-r2", newData: { b: 1 } },
    { userId: undefined, action: "DELETE", tableName: "TEST-PHASE0", recordId: "TEST-r3" },
  ]);
  const after = await prisma.systemLog.count({ where: { tableName: "TEST-PHASE0" } });
  check("logMany: 3 entry → 3 SystemLog satırı", after - before === 3, `Δ=${after - before}`);

  await AuditService.logMany([]);
  const afterEmpty = await prisma.systemLog.count({ where: { tableName: "TEST-PHASE0" } });
  check("logMany: boş dizi → no-op", afterEmpty === after);

  const r3 = await prisma.systemLog.findFirst({
    where: { tableName: "TEST-PHASE0", recordId: "TEST-r3" },
    select: { category: true, userId: true, action: true },
  });
  check("logMany: category = DOMAIN", r3?.category === "DOMAIN");
  check("logMany: userId undefined → null saklandı", r3?.userId === null);
  check("logMany: action korunur (DELETE)", r3?.action === "DELETE");
}

// ── B) getCancelPreview gruplama doğruluğu (N+1 sonrası) ─────────────────────
async function testCancelPreviewGrouping(): Promise<void> {
  console.log("\n=== B) order.getCancelPreview gruplama ===");
  const stamp = `${Date.now()}`.slice(-7) + Math.floor(Math.random() * 1000);

  const orderA = await prisma.order.create({
    data: {
      orderNumber: `TST-P0-A-${stamp}`,
      customerId: CUSTOMER,
      status: "APPROVED",
      lines: { create: [{ itemId: ITEM, width: WIDTH, quantity: 100 }] },
    },
    include: { lines: true },
  });
  const orderB = await prisma.order.create({
    data: {
      orderNumber: `TST-P0-B-${stamp}`,
      customerId: CUSTOMER,
      status: "APPROVED",
      lines: { create: [{ itemId: ITEM, width: WIDTH, quantity: 100 }] },
    },
    include: { lines: true },
  });
  orderIds.push(orderA.id, orderB.id);
  const lineA = orderA.lines[0].id;
  const lineB = orderB.lines[0].id;

  const mkWo = async (n: number) =>
    prisma.workOrder.create({
      data: {
        batchNumber: `TST-P0-WO${n}-${stamp}`,
        type: "STOCK_PRODUCTION",
        status: "IN_PROGRESS",
        width: WIDTH,
        targetQuantity: 100,
        targetItemId: ITEM,
        steps: { create: [{ stationId: STATION, stepSequence: 1, status: "PENDING" as const }] },
      },
      include: { steps: true },
    });
  const wo1 = await mkWo(1); // A + B'ye bağlı (paylaşımlı)
  const wo2 = await mkWo(2); // yalnız A'ya bağlı (sole)
  woIds.push(wo1.id, wo2.id);

  await prisma.workOrderToOrderLine.createMany({
    data: [
      { workOrderId: wo1.id, orderLineId: lineA },
      { workOrderId: wo1.id, orderLineId: lineB },
      { workOrderId: wo2.id, orderLineId: lineA },
    ],
  });

  // wo1'in step'inde 3 üretim topu; wo2'de 0.
  const step1 = wo1.steps[0].id;
  for (let i = 0; i < 3; i++) {
    await prisma.roll.create({
      data: {
        barcode: `TST-P0-${stamp}-${i}`,
        itemId: ITEM,
        initialQty: 10,
        currentQty: 10,
        status: RollStatus.WAREHOUSE,
        qualityGrade: "1.KALITE",
        qualityGradeId: GRADE,
        width: WIDTH,
        createdById: ADMIN,
        producedInStepId: step1,
      },
    });
  }

  const res = await orderService.getCancelPreview(orderA.id);
  const data = res.data as {
    affectedWorkOrders: Array<{
      id: string;
      isSoleOrder: boolean;
      otherOrdersCount: number;
      otherOrderNumbers: string[];
      producedRollCount: number;
    }>;
  };
  const a1 = data.affectedWorkOrders.find((w) => w.id === wo1.id);
  const a2 = data.affectedWorkOrders.find((w) => w.id === wo2.id);

  check("preview: WO1 + WO2 ikisi de listede", !!a1 && !!a2);
  check("preview: WO1 isSoleOrder=false (B'ye de bağlı)", a1?.isSoleOrder === false);
  check("preview: WO1 otherOrdersCount=1", a1?.otherOrdersCount === 1, `=${a1?.otherOrdersCount}`);
  check(
    "preview: WO1 otherOrderNumbers B siparişini içerir",
    !!a1 && a1.otherOrderNumbers.includes(orderB.orderNumber),
    JSON.stringify(a1?.otherOrderNumbers)
  );
  check("preview: WO1 producedRollCount=3 (groupBy)", a1?.producedRollCount === 3, `=${a1?.producedRollCount}`);
  check("preview: WO2 isSoleOrder=true (yalnız A)", a2?.isSoleOrder === true);
  check("preview: WO2 otherOrdersCount=0", a2?.otherOrdersCount === 0, `=${a2?.otherOrdersCount}`);
  check("preview: WO2 producedRollCount=0", a2?.producedRollCount === 0, `=${a2?.producedRollCount}`);
}

async function cleanup(): Promise<void> {
  const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const stepIds = steps.map((s) => s.id);
  const rolls = await prisma.roll.findMany({
    where: { OR: [{ barcode: { startsWith: "TST-P0-" } }, { producedInStepId: { in: stepIds } }] },
    select: { id: true },
  });
  await prisma.roll.deleteMany({ where: { id: { in: rolls.map((r) => r.id) } } });
  await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  const orderLines = await prisma.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  await prisma.orderLine.deleteMany({ where: { id: { in: orderLines.map((l) => l.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.systemLog.deleteMany({ where: { tableName: "TEST-PHASE0" } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await testLogMany();
    await testCancelPreviewGrouping();
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
