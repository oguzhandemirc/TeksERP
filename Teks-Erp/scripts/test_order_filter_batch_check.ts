// İş emri parti kodu blur kontrolü + sipariş ürün/renk filtresi testi.
// Çalıştırma:  npx ts-node scripts/test_order_filter_batch_check.ts
//
// Veri: HER İKİ bölüm de kendi tek kullanımlık kayıtlarını yaratıp siler
// (seed/operasyonel veriden bağımsız). checkBatchNumber için bir WorkOrder;
// sipariş filtresi için 1 müşteri + 4 sipariş (bilinen ürün/renk kompozisyonu).
//
// Doğrulananlar:
//   A. checkBatchNumber
//     1. Var olan kod → available=false
//     2. Var olan kod + excludeId(kendisi) → available=true (düzenleme modu)
//     3. Boş kod → available=true (otomatik üretilecek)
//     4. Olmayan kod → available=true
//     5. Boşluklu var olan kod (trim) → available=false
//   B. Sipariş ürün/renk filtresi (OrderService.extraWhere → lines.some)
//     6.  filter[itemId]: pagination.total = prisma count (extraWhere doğru where üretiyor)
//     7.  filter[itemId]: doğru siparişler döndü (o1,o2,o4 var; o3 yok)
//     8.  filter[itemId]: dönen her siparişte o ürün var
//     9.  filter[colorId]: total = prisma count + doğru siparişler (o1,o3,o4 var; o2 yok)
//     10. filter[itemId]+filter[colorId] (aynı kalem): total = prisma count
//     11. Kombine filtre doğru siparişler (o1,o4 var; o2,o3 yok)
//     12. Olmayan itemId → 0 sipariş (negatif)

import { Request } from "express";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { OrderService } from "../src/services/order.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// parseQueryParams yalnız req.query'yi okur — gerçek HTTP gerekmez.
function makeReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

interface OffsetResult {
  data: Array<{ id: string; lines: Array<{ itemId: string; colorId: string | null }> }>;
  pagination: { total: number };
}
const idsOf = (r: OffsetResult): Set<string> => new Set(r.data.map((o) => o.id));

async function main(): Promise<void> {
  // ============== PART A: checkBatchNumber ==============
  const woSvc = new WorkOrderService();
  const uniqueCode = `TEST-PARTI-${Date.now()}`;
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: uniqueCode } });
  try {
    const r1 = await woSvc.checkWorkOrderNumber(uniqueCode);
    check("1. Var olan kod → available=false", r1.available === false, JSON.stringify(r1));

    const r2 = await woSvc.checkWorkOrderNumber(uniqueCode, wo.id);
    check("2. Var olan kod + excludeId(kendisi) → available=true", r2.available === true, JSON.stringify(r2));

    const r3 = await woSvc.checkWorkOrderNumber("");
    check("3. Boş kod → available=true", r3.available === true, JSON.stringify(r3));

    const r4 = await woSvc.checkWorkOrderNumber(`YOK-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
    check("4. Olmayan kod → available=true", r4.available === true, JSON.stringify(r4));

    const r5 = await woSvc.checkWorkOrderNumber(`  ${uniqueCode}  `);
    check("5. Boşluklu var olan kod (trim) → available=false", r5.available === false, JSON.stringify(r5));
  } finally {
    await prisma.workOrder.delete({ where: { id: wo.id } });
  }

  // ============== PART B: sipariş ürün/renk filtresi ==============
  const orderSvc = new OrderService({
    modelName: "order",
    tableName: "ORDER",
    searchFields: [],
    codeSearchFields: ["orderNumber"],
    dateFields: ["createdAt", "deadline"],
    defaultInclude: { lines: { include: { item: true, color: true } } },
    nestedCreateFields: ["lines"],
  });

  // Part B kendi master verisini yaratır (minimal seed'de yalnız 1 ürün olabilir;
  // seed kompozisyonundan bağımsız olsun diye 2 ürün + 2 renk + 1 müşteri üretilir).
  // Sonda (finally) temizlenir.
  const tsB = Date.now();
  const customer = await prisma.customer.create({
    data: { code: `TST-CUS-${tsB}`, name: "Test Müşteri" },
    select: { id: true },
  });
  const items = await Promise.all([
    prisma.item.create({ data: { code: `TST-ITMA-${tsB}`, name: "Test Ürün A", itemType: "FABRIC", unit: "MT" }, select: { id: true } }),
    prisma.item.create({ data: { code: `TST-ITMB-${tsB}`, name: "Test Ürün B", itemType: "FABRIC", unit: "MT" }, select: { id: true } }),
  ]);
  const colors = await Promise.all([
    prisma.color.create({ data: { code: `TST-CLRA-${tsB}`, name: "Test Renk A" }, select: { id: true } }),
    prisma.color.create({ data: { code: `TST-CLRB-${tsB}`, name: "Test Renk B" }, select: { id: true } }),
  ]);

  if (items.length < 2 || colors.length < 2 || !customer) {
    check("B. Yeterli master veri yok (2 ürün + 2 renk + 1 müşteri)", false, "Part B atlandı");
  } else {
    const [itemA, itemB] = items;
    const [colorA, colorB] = colors;
    const ts = Date.now();
    const mk = (n: number, lines: Array<{ itemId: string; colorId: string; quantity: number }>) =>
      prisma.order.create({
        data: { orderNumber: `TEST-ORD-${ts}-${n}`, customerId: customer.id, lines: { create: lines } },
        select: { id: true },
      });

    // Kompozisyon:  o1=(A,a)  o2=(A,b)  o3=(B,a)  o4=[(B,b),(A,a)]
    const o1 = await mk(1, [{ itemId: itemA.id, colorId: colorA.id, quantity: 100 }]);
    const o2 = await mk(2, [{ itemId: itemA.id, colorId: colorB.id, quantity: 100 }]);
    const o3 = await mk(3, [{ itemId: itemB.id, colorId: colorA.id, quantity: 100 }]);
    const o4 = await mk(4, [
      { itemId: itemB.id, colorId: colorB.id, quantity: 100 },
      { itemId: itemA.id, colorId: colorA.id, quantity: 50 },
    ]);
    const createdIds = [o1.id, o2.id, o3.id, o4.id];

    try {
      // 6-8: itemA filtresi → o1,o2,o4 (o3 yok)
      const resItem = (await orderSvc.findAll(
        makeReq({ "filter[itemId]": itemA.id, pageSize: "200" }),
      )) as OffsetResult;
      const expItem = await prisma.order.count({ where: { lines: { some: { itemId: itemA.id } } } });
      check("6. Ürün filtresi: total = prisma count", resItem.pagination.total === expItem,
        `service=${resItem.pagination.total} prisma=${expItem}`);
      const itemIds = idsOf(resItem);
      check("7. Ürün filtresi: doğru siparişler (o1,o2,o4 var; o3 yok)",
        itemIds.has(o1.id) && itemIds.has(o2.id) && itemIds.has(o4.id) && !itemIds.has(o3.id));
      check("8. Ürün filtresi: dönen her siparişte o ürün var",
        resItem.data.every((o) => o.lines.some((l) => l.itemId === itemA.id)),
        `${resItem.data.length} sipariş kontrol edildi`);

      // 9: colorA filtresi → o1,o3,o4 (o2 yok)
      const resColor = (await orderSvc.findAll(
        makeReq({ "filter[colorId]": colorA.id, pageSize: "200" }),
      )) as OffsetResult;
      const expColor = await prisma.order.count({ where: { lines: { some: { colorId: colorA.id } } } });
      const colorIds = idsOf(resColor);
      check("9. Renk filtresi: total = prisma count + doğru siparişler (o1,o3,o4 var; o2 yok)",
        resColor.pagination.total === expColor &&
          colorIds.has(o1.id) && colorIds.has(o3.id) && colorIds.has(o4.id) && !colorIds.has(o2.id),
        `service=${resColor.pagination.total} prisma=${expColor}`);

      // 10-11: itemA + colorA (aynı kalem) → o1, o4 (o2,o3 yok)
      const resBoth = (await orderSvc.findAll(
        makeReq({ "filter[itemId]": itemA.id, "filter[colorId]": colorA.id, pageSize: "200" }),
      )) as OffsetResult;
      const expBoth = await prisma.order.count({
        where: { lines: { some: { itemId: itemA.id, colorId: colorA.id } } },
      });
      check("10. Ürün+Renk filtresi (aynı kalem): total = prisma count",
        resBoth.pagination.total === expBoth, `service=${resBoth.pagination.total} prisma=${expBoth}`);
      const bothIds = idsOf(resBoth);
      check("11. Kombine filtre: doğru siparişler (o1,o4 var; o2,o3 yok)",
        bothIds.has(o1.id) && bothIds.has(o4.id) && !bothIds.has(o2.id) && !bothIds.has(o3.id));

      // 12: olmayan ürün → 0
      const resNone = (await orderSvc.findAll(
        makeReq({ "filter[itemId]": "00000000-0000-0000-0000-000000000000", pageSize: "200" }),
      )) as OffsetResult;
      check("12. Olmayan ürün filtresi → 0 sipariş", resNone.pagination.total === 0,
        `total=${resNone.pagination.total}`);
    } finally {
      await prisma.order.deleteMany({ where: { id: { in: createdIds } } });
      await prisma.customer.delete({ where: { id: customer.id } });
      await prisma.item.deleteMany({ where: { id: { in: [itemA.id, itemB.id] } } });
      await prisma.color.deleteMany({ where: { id: { in: [colorA.id, colorB.id] } } });
    }
  }

  console.log(`\n${pass} geçti, ${fail} kaldı`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
