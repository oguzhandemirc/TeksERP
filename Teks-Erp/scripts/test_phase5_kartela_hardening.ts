// =============================================================================
// TEST: Faz 5 — broad-audit güvenli sertleştirme (Kartela denetimi turundan)
// Çalıştır: npx tsx scripts/test_phase5_kartela_hardening.ts
// =============================================================================
// NOT: Kartela domaini (kartela.service) denetimde TEMİZ çıktı. Bu tur cross-domain
// LOW bulgular getirdi; shiplenen: order.reopen atomik claim, return qualityGrade
// isActive guard, tambur.listOpenCards take cap. Burada flagship = reopen claim.
// =============================================================================

import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { AppError } from "../src/utils/app-error";
import { OrderStatus } from "@prisma/client";

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

const orders = new OrderService({ modelName: "order", tableName: "ORDER" });
let ITEM = "",
  CUSTOMER = "",
  ADMIN = "";
const orderIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
}

async function makeManualClosedOrder(): Promise<string> {
  const o = await prisma.order.create({
    data: {
      orderNumber: `TST-P5-ORD-${orderIds.length}-${Date.now().toString().slice(-5)}`,
      customerId: CUSTOMER,
      status: OrderStatus.COMPLETED,
      manualClosedById: ADMIN,
      manualCloseReason: "test manuel kapatma",
      completedAt: new Date(),
      lines: { create: [{ itemId: ITEM, width: 150, quantity: 100 }] },
    },
  });
  orderIds.push(o.id);
  return o.id;
}

async function testReopenClaim(): Promise<void> {
  console.log("\n=== order.reopen atomik claim ===");
  const o1 = await makeManualClosedOrder();
  const r = await orders.reopen(o1, "tekrar aç", ADMIN);
  check("reopen happy: success", r.success === true);
  const a1 = await prisma.order.findUnique({ where: { id: o1 }, select: { status: true, manualClosedById: true } });
  check("reopen happy: manualClosedById temizlendi", a1?.manualClosedById === null);
  check("reopen happy: terminal değil (APPROVED/PARTIAL)", a1?.status !== OrderStatus.COMPLETED);

  const o2 = await makeManualClosedOrder();
  const settled = await Promise.allSettled([orders.reopen(o2, "paralel A", ADMIN), orders.reopen(o2, "paralel B", ADMIN)]);
  const ok = settled.filter((s) => s.status === "fulfilled").length;
  const conflict = settled.filter((s) => s.status === "rejected" && is409((s as PromiseRejectedResult).reason)).length;
  check("paralel reopen: tam 1 başarılı", ok === 1, `ok=${ok}`);
  check("paralel reopen: tam 1 × 409 (claim)", conflict === 1, `409=${conflict}`);
}

async function cleanup(): Promise<void> {
  const lines = await prisma.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  await prisma.orderLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await testReopenClaim();
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
