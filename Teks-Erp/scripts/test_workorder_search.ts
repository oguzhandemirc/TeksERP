// =============================================================================
// Test: İş emri araması — sipariş no path'i (WorkOrderService.findAll)
// Çalıştır: npx tsx scripts/test_workorder_search.ts
// Kurulum: 1 müşteri + 1 kumaş + 1 sipariş (1 kalem) + 2 iş emri:
//          woLinked kaleme bağlı (WorkOrderToOrderLine), woUnlinked bağsız.
// Doğrulananlar:
//   1. Tam sipariş no → yalnız bağlı WO döner (bağsız WO yok)
//   2. Kısmi sipariş no → bağlı WO bulunur
//   3. İE no araması regresyonsuz (bağsız WO kendi numarasıyla bulunur)
//   4. Eşleşmeyen terim → 0
//   5. Müşteri adı araması regresyonsuz (bağ üzerinden bağlı WO döner)
// =============================================================================
import { Request } from "express";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";

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

interface WoResult {
  data: Array<{ id: string; workOrderNumber: string }>;
  pagination: { total: number };
}

async function main(): Promise<void> {
  const ts = Date.now();
  const svc = new WorkOrderService();

  const orderNumber = `TEST-WOSRCH-ORD-${ts}`;
  const woLinkedNo = `TEST-WOSRCH-IE-${ts}`;
  const woUnlinkedNo = `TEST-WOSRCH-IE2-${ts}`;
  const customerName = `TEST WOSRCH MUSTERI ${ts}`;

  const customer = await prisma.customer.create({
    data: { code: `TEST-WOSRCH-CUS-${ts}`, name: customerName },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TEST-WOSRCH-ITM-${ts}`, name: `TEST WOSRCH KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: customer.id,
      lines: { create: [{ itemId: item.id, quantity: 100 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  const orderLineId = order.lines[0].id;
  const woLinked = await prisma.workOrder.create({
    data: { workOrderNumber: woLinkedNo },
    select: { id: true },
  });
  const woUnlinked = await prisma.workOrder.create({
    data: { workOrderNumber: woUnlinkedNo },
    select: { id: true },
  });
  await prisma.workOrderToOrderLine.create({
    data: { workOrderId: woLinked.id, orderLineId },
  });

  const search = async (term: string): Promise<WoResult> =>
    (await svc.findAll(makeReq({ search: term, pageSize: "200" }))) as WoResult;
  const numsOf = (r: WoResult): Set<string> => new Set(r.data.map((w) => w.workOrderNumber));

  try {
    // 1) Tam sipariş no → yalnız bağlı WO
    const byOrderNo = await search(orderNumber);
    const nums1 = numsOf(byOrderNo);
    check("1. Tam sipariş no → bağlı WO döner", nums1.has(woLinkedNo));
    check("1b. Bağsız WO bu aramada YOK", !nums1.has(woUnlinkedNo));

    // 2) Kısmi sipariş no (prefix'siz substring)
    const byPartial = await search(`WOSRCH-ORD-${ts}`);
    check("2. Kısmi sipariş no → bağlı WO bulunur", numsOf(byPartial).has(woLinkedNo));

    // 3) İE no araması regresyonsuz — bağsız WO kendi numarasıyla bulunur
    const byWoNo = await search(woUnlinkedNo);
    check("3. İE no araması regresyonsuz", numsOf(byWoNo).has(woUnlinkedNo));

    // 4) Eşleşmeyen terim → 0
    const none = await search(`YOK-WOSRCH-${ts}`);
    check("4. Eşleşmeyen terim → 0", none.pagination.total === 0, `total=${none.pagination.total}`);

    // 5) Müşteri adı araması regresyonsuz — bağ üzerinden bağlı WO döner
    const byCust = await search(customerName);
    check("5. Müşteri adı araması regresyonsuz (bağlı WO döner)", numsOf(byCust).has(woLinkedNo));
  } finally {
    await prisma.workOrderToOrderLine.deleteMany({ where: { orderLineId } });
    await prisma.workOrder.deleteMany({ where: { id: { in: [woLinked.id, woUnlinked.id] } } });
    await prisma.order.delete({ where: { id: order.id } }).catch(() => {}); // cascade → lines
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
