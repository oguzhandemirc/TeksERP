// =============================================================================
// TEST: Faz 4 — broad-audit güvenli sertleştirme (Fason denetimi turundan)
// Çalıştır: npx tsx scripts/test_phase4_fason_hardening.ts
// =============================================================================
// NOT: Fason domaini (subcontractor.service) denetimde TEMİZ çıktı (yarış PR'ları
// kapsamış). Bu tur cross-domain bulgular getirdi; aşağıdakiler shiplenenler:
//   A) ProductRecipe FK isActive + width pozitif guard'ı.
//   B) Order.manualComplete ATOMİK CLAIM (2 paralel → tam 1×409).
// =============================================================================

import prisma from "../src/lib/prisma";
import { ProductRecipeService } from "../src/services/product-recipe.service";
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
const is400 = (e: unknown) => e instanceof AppError && e.statusCode === 400;
const NONEXISTENT = "00000000-0000-0000-0000-000000000000";

const recipes = new ProductRecipeService({
  modelName: "productRecipe",
  tableName: "PRODUCT_RECIPE",
  nestedCreateFields: ["properties"],
});
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

// ── A) ProductRecipe validation ──────────────────────────────────────────────
async function testRecipeValidation(): Promise<void> {
  console.log("\n=== A) ProductRecipe FK isActive + width guard ===");
  const stamp = Date.now().toString().slice(-6);

  let badItem: unknown;
  try {
    await recipes.create({ code: `TST-P4-RCP-BADITEM-${stamp}`, name: "t", itemId: NONEXISTENT }, ADMIN);
  } catch (e) {
    badItem = e;
  }
  check("recipe geçersiz itemId → 400", is400(badItem));

  let badWidth: unknown;
  try {
    await recipes.create({ code: `TST-P4-RCP-BADW-${stamp}`, name: "t", itemId: ITEM, width: -5 }, ADMIN);
  } catch (e) {
    badWidth = e;
  }
  check("recipe negatif width → 400", is400(badWidth));

  const okRes = await recipes.create({ code: `TST-P4-RCP-OK-${stamp}`, name: "t", itemId: ITEM, width: 150 }, ADMIN);
  const okId = (okRes.data as { id?: string } | null)?.id;
  check("recipe geçerli → success", okRes.success === true && !!okId);

  let updW: unknown;
  try {
    if (okId) await recipes.update(okId, { width: 0 }, ADMIN);
  } catch (e) {
    updW = e;
  }
  check("recipe update width=0 → 400", is400(updW));
}

// ── B) Order.manualComplete atomik claim ─────────────────────────────────────
async function makeApprovedOrder(): Promise<string> {
  const o = await prisma.order.create({
    data: {
      orderNumber: `TST-P4-ORD-${orderIds.length}-${Date.now().toString().slice(-5)}`,
      customerId: CUSTOMER,
      status: OrderStatus.APPROVED,
      lines: { create: [{ itemId: ITEM, width: 150, quantity: 100 }] },
    },
  });
  orderIds.push(o.id);
  return o.id;
}

async function testManualCompleteClaim(): Promise<void> {
  console.log("\n=== B) Order.manualComplete atomik claim ===");
  const o1 = await makeApprovedOrder();
  const r = await orders.manualComplete(o1, "manuel test kapatma", ADMIN);
  check("manualComplete happy: success", r.success === true);
  const a1 = await prisma.order.findUnique({ where: { id: o1 }, select: { status: true } });
  check("manualComplete happy: COMPLETED", a1?.status === OrderStatus.COMPLETED);

  const o2 = await makeApprovedOrder();
  const settled = await Promise.allSettled([
    orders.manualComplete(o2, "paralel kapatma A", ADMIN),
    orders.manualComplete(o2, "paralel kapatma B", ADMIN),
  ]);
  const ok = settled.filter((s) => s.status === "fulfilled").length;
  const conflict = settled.filter((s) => s.status === "rejected" && is409((s as PromiseRejectedResult).reason)).length;
  check("paralel manualComplete: tam 1 başarılı", ok === 1, `ok=${ok}`);
  check("paralel manualComplete: tam 1 × 409 (claim)", conflict === 1, `409=${conflict}`);
}

async function cleanup(): Promise<void> {
  await prisma.productRecipeProperty.deleteMany({
    where: { recipe: { code: { startsWith: "TST-P4-RCP" } } },
  }).catch(() => undefined);
  await prisma.productRecipe.deleteMany({ where: { code: { startsWith: "TST-P4-RCP" } } });
  const lines = await prisma.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  await prisma.orderLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await testRecipeValidation();
    await testManualCompleteClaim();
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
