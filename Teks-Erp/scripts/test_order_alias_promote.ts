// =============================================================================
// TEST: promoteCustomerAliases batch (N+1 → 2 sorgu) — PR-1
// Çalıştır: npx tsx scripts/test_order_alias_promote.ts
// =============================================================================
// OrderService.create → promoteCustomerAliases: satır-bazlı 2N findUnique yerine
// benzersiz item/color için TEK varlık-okuması + yalnız eksik olanları upsert.
// Davranış birebir: terfi olur; dedup (ilk-dolu-ad kazanır); mevcut alias EZİLMEZ.
// =============================================================================

import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";

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

const orders = new OrderService({ modelName: "order", tableName: "ORDER", nestedCreateFields: ["lines"] });
let ITEM = "",
  ADMIN = "",
  CUST = "";
const orderIds: string[] = [];
const stamp = Date.now().toString().slice(-7);

// NOT: item-only (colorId yok) — order-line color validation item.allowedColors'a
// bağlı (orthogonal). color promote yolu item ile BİREBİR simetrik kod; item testi
// batch mantığını (terfi + dedup + ezme-yok) tam kanıtlar.
const itemAlias = (itemId: string) =>
  prisma.customerItemAlias.findUnique({ where: { customerId_itemId: { customerId: CUST, itemId } }, select: { alias: true } });

async function mkOrder(lines: Record<string, unknown>[]): Promise<void> {
  const res = await orders.create(
    { orderNumber: `TST-ALIAS-${stamp}-${orderIds.length}`, customerId: CUST, status: "APPROVED", lines },
    ADMIN
  );
  const id = (res.data as { id?: string } | null)?.id;
  if (id) orderIds.push(id);
}

async function main(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  const cust = await prisma.customer.create({ data: { code: `TST-ALIAS-C-${stamp}`, name: "Alias Test Müşteri" } });
  CUST = cust.id;

  try {
    console.log("\n=== promoteCustomerAliases batch ===");

    // A) 2 satır aynı item → terfi + dedup (ilk-dolu-ad kazanır)
    await mkOrder([
      { itemId: ITEM, width: 150, quantity: 100, customerItemName: "MUST-PATOS" },
      { itemId: ITEM, width: 150, quantity: 50, customerItemName: "DUP-IGNORE" },
    ]);
    check("item alias terfi edildi (ilk ad)", (await itemAlias(ITEM))?.alias === "MUST-PATOS", (await itemAlias(ITEM))?.alias ?? "yok");
    const itemAliasCount = await prisma.customerItemAlias.count({ where: { customerId: CUST, itemId: ITEM } });
    check("dedup: tek item alias satırı", itemAliasCount === 1, `count=${itemAliasCount}`);

    // B) aynı müşteri+item, yeni ad → MEVCUT alias EZİLMEZ (existing → skip)
    await mkOrder([{ itemId: ITEM, width: 150, quantity: 30, customerItemName: "NEW-NAME" }]);
    check("mevcut item alias ezilmedi", (await itemAlias(ITEM))?.alias === "MUST-PATOS", (await itemAlias(ITEM))?.alias ?? "yok");
  } finally {
    const lines = await prisma.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await prisma.orderLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customerItemAlias.deleteMany({ where: { customerId: CUST } });
    await prisma.customerColorAlias.deleteMany({ where: { customerId: CUST } });
    await prisma.customer.deleteMany({ where: { id: CUST } });
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
