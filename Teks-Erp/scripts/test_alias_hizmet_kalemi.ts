// =============================================================================
// TEST: müşteri ürün adı yalnız STOK kalemine — hizmet kalemi 400 (Gülkesim 2026-11-06)
// Çalıştır: npx tsx scripts/test_alias_hizmet_kalemi.ts
// =============================================================================
// Cari → "Müşterideki ad" seçicisi hizmet kalemlerini de listeliyordu; yazma ucu da kabul
// ediyordu. Kapı `assertAliasItem` (customer-alias-gates.helper) iki alias tablosunda ortak:
//   A) hizmet kalemine ürün adı → 400 ALIAS_ITEM_NOT_STOCK, satır yazılmaz
//   B) hizmet kalemine kumaşa özel renk adı → 400 ALIAS_ITEM_NOT_STOCK
//   C) kumaş kalemine ürün adı → yazılır (bugünkü davranış)
// Sonda (ölçüldü, geri alındı): kapıdaki SERVICE koşulu kaldırılınca A1/A2/B1 kırmızı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { CustomerAliasService } from "../src/services/customer-alias.service";
import { AppError } from "../src/utils/app-error";

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

const svc = new CustomerAliasService();
const stamp = Date.now().toString().slice(-7);
const ids = { customer: "", service: "", fabric: "", color: "" };

async function caught(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}

async function setup(): Promise<void> {
  ids.customer = (await prisma.customer.create({ data: { code: `TST-AH-${stamp}`, name: `TST ALIAS HIZMET ${stamp}` }, select: { id: true } })).id;
  ids.service = (await prisma.item.create({ data: { code: `TST-AH-S-${stamp}`, name: `TST HIZMET ${stamp}`, itemType: "SERVICE" }, select: { id: true } })).id;
  ids.fabric = (await prisma.item.create({ data: { code: `TST-AH-F-${stamp}`, name: `TST KUMAS ${stamp}`, itemType: "FABRIC" }, select: { id: true } })).id;
  ids.color = (await prisma.color.create({ data: { code: `TST-AH-C-${stamp}`, name: `TST AH RENK ${stamp}` }, select: { id: true } })).id;
}

async function run(): Promise<void> {
  console.log("\n=== A) hizmet kalemine müşteri ürün adı ===");
  const a = await caught(() => svc.upsertItemAlias(ids.customer, ids.service, "HIZMET ADI"));
  check("A1 ⭐ 400", a?.statusCode === 400, `${a?.statusCode ?? "hata yok"}`);
  check("A2 ⭐ details.code = ALIAS_ITEM_NOT_STOCK", a?.details?.code === "ALIAS_ITEM_NOT_STOCK", String(a?.details?.code));
  const row = await prisma.customerItemAlias.findUnique({ where: { customerId_itemId: { customerId: ids.customer, itemId: ids.service } } });
  check("A3 satır yazılmadı", row === null);

  console.log("\n=== B) hizmet kalemine kumaşa özel renk adı ===");
  const b = await caught(() => svc.upsertItemColorAlias({ customerId: ids.customer, itemId: ids.service, colorId: ids.color }, "RENK"));
  check("B1 ⭐ 400 ALIAS_ITEM_NOT_STOCK", b?.statusCode === 400 && b.details?.code === "ALIAS_ITEM_NOT_STOCK", `${b?.statusCode} ${String(b?.details?.code)}`);

  console.log("\n=== C) kumaş kalemi — bugünkü davranış ===");
  const c = await svc.upsertItemAlias(ids.customer, ids.fabric, "aktos");
  check("C1 kumaşa ad yazıldı (büyük harf)", c.success && c.data?.alias === "AKTOS", c.data?.alias ?? "yok");
}

async function cleanup(): Promise<void> {
  await prisma.customerItemColorAlias.deleteMany({ where: { customerId: ids.customer } });
  await prisma.customerItemAlias.deleteMany({ where: { customerId: ids.customer } });
  if (ids.color) await prisma.color.deleteMany({ where: { id: ids.color } });
  await prisma.item.deleteMany({ where: { id: { in: [ids.service, ids.fabric].filter(Boolean) } } });
  if (ids.customer) await prisma.customer.deleteMany({ where: { id: ids.customer } });
}

async function main(): Promise<void> {
  try {
    await setup();
    await run();
  } finally {
    await cleanup().catch((e) => console.log("  (temizlik hatası)", e));
    await prisma.$disconnect();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
