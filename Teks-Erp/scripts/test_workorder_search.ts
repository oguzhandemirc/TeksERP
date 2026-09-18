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
//   6–9. MÜŞTERİ KOLONU (2026-09-15; 2026-09-18 BİRİNCİL = İLK BAĞLANAN): satır `customers` DISTINCT + BAĞLANMA sıralı
//        (A ilk bağlandı < B; ad sırasında önce gelen D SON bağlandı → sonda) + `customerCount`;
//        KOPARILMIŞ bağın (unlinkedAt) müşterisi sayılmaz; bağsız WO `[]`/0; `filter[customerId]` (tek · CSV)
//        bağ üzerinden süzer, koparılmış bağ eşleşmez; rollup >5 müşteride önizleme 5 + toplam (saf).
//   NEGATİF SONDA (2026-09-15, kırmızı görüldü): select'teki `where: ACTIVE_ORDER_LINK` düşürülünce 6b ❌;
//        `readIdCondition(customerId)` satırı düşürülünce 8a "Unknown argument" 500 ❌.
//   NEGATİF SONDA (2026-09-18, kırmızı görüldü): rollup yeniden ad sırasına (`localeCompare`) çevrilince 6a/9/9b ❌.
// =============================================================================
import { Request } from "express";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { WO_CUSTOMER_PREVIEW, rollupWorkOrderCustomers } from "../src/services/helpers/work-order-customers.helper";

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
  data: Array<{ id: string; workOrderNumber: string; customers: Array<{ id: string; name: string }>; customerCount: number }>;
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
  // Müşteri kolonu fikstürü: B (ad sırasında A'dan SONRA; iki kalemi de bağlı → distinct), C (bağı
  // KOPARILMIŞ → listeye girmemeli) ve D (ad sırasında HEPSİNDEN ÖNCE ama EN SON bağlanan → birincil
  // OLMAMALI). Adlar "TEST WOSRCH AAA" < "TEST WOSRCH MUSTERI" < "TEST WOSRCH ZB" < "TEST WOSRCH ZC".
  const custB = await prisma.customer.create({ data: { code: `TEST-WOSRCH-CB-${ts}`, name: `TEST WOSRCH ZB ${ts}` }, select: { id: true } });
  const custC = await prisma.customer.create({ data: { code: `TEST-WOSRCH-CC-${ts}`, name: `TEST WOSRCH ZC ${ts}` }, select: { id: true } });
  const orderB = await prisma.order.create({
    data: { orderNumber: `TEST-WOSRCH-ORB-${ts}`, customerId: custB.id, lines: { create: [{ itemId: item.id, quantity: 10 }, { itemId: item.id, quantity: 20 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const orderC = await prisma.order.create({
    data: { orderNumber: `TEST-WOSRCH-ORC-${ts}`, customerId: custC.id, lines: { create: [{ itemId: item.id, quantity: 5 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const custD = await prisma.customer.create({ data: { code: `TEST-WOSRCH-CD-${ts}`, name: `TEST WOSRCH AAA ${ts}` }, select: { id: true } });
  const orderD = await prisma.order.create({
    data: { orderNumber: `TEST-WOSRCH-ORDD-${ts}`, customerId: custD.id, lines: { create: [{ itemId: item.id, quantity: 7 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const extraLineIds = [...orderB.lines.map((l) => l.id), ...orderC.lines.map((l) => l.id), ...orderD.lines.map((l) => l.id)];
  for (const l of orderB.lines) await prisma.workOrderToOrderLine.create({ data: { workOrderId: woLinked.id, orderLineId: l.id } });
  await prisma.workOrderToOrderLine.create({ data: { workOrderId: woLinked.id, orderLineId: orderC.lines[0].id, unlinkedAt: new Date(), unlinkReason: "sonda" } });
  // D EN SON bağlanır — damga farkı garanti olsun diye ileri tarihli createdAt (aynı ms'de doğan bağlar eşit sayılırdı).
  await prisma.workOrderToOrderLine.create({ data: { workOrderId: woLinked.id, orderLineId: orderD.lines[0].id, createdAt: new Date(Date.now() + 60_000) } });

  const search = async (term: string): Promise<WoResult> =>
    (await svc.findAll(makeReq({ search: term, pageSize: "200" }))) as WoResult;
  const byFilter = async (customerId: string): Promise<WoResult> =>
    (await svc.findAll(makeReq({ search: `WOSRCH-IE`, "filter[customerId]": customerId, pageSize: "200" }))) as WoResult;
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

    // 6) Müşteri kolonu — DISTINCT + BAĞLANMA sıralı + toplam; koparılmış bağ sayılmaz
    const rows = (await search(`WOSRCH-IE`)).data;
    const linkedRow = rows.find((w) => w.workOrderNumber === woLinkedNo);
    const unlinkedRow = rows.find((w) => w.workOrderNumber === woUnlinkedNo);
    const names = (linkedRow?.customers ?? []).map((c) => c.name);
    check("6a ⭐ bağlı WO `customers` DISTINCT (B'nin iki kalemi tek satır) ve BAĞLANMA sıralı [A, B, D] — D ad sırasında ilk ama SON bağlandı, birincil A; customerCount 3",
      names.length === 3 && names[0] === customerName && names[1] === `TEST WOSRCH ZB ${ts}` && names[2] === `TEST WOSRCH AAA ${ts}` && linkedRow?.customerCount === 3, names.join(" | "));
    const detay = (await svc.findById(woLinked.id)).data as { orderLinks?: Array<{ createdAt: string | Date; orderLine: { order: { customer: { id: string } } } }> } | null;
    const detayMusteri = (detay?.orderLinks ?? []).map((l) => l.orderLine.order.customer.id);
    check("6d detay `orderLinks` liste ile AYNI sırada (createdAt asc): ilk A, son D",
      detayMusteri.length === 4 && detayMusteri[0] === customer.id && detayMusteri[3] === custD.id, detayMusteri.join(","));
    check("6b ⭐ KOPARILMIŞ bağın müşterisi (C) listede YOK", !!linkedRow && !linkedRow.customers.some((c) => c.id === custC.id));
    check("6c satır yalnız id+ad taşır (sipariş no/adres sızmaz)", !!linkedRow && linkedRow.customers.every((c) => Object.keys(c).sort().join(",") === "id,name"));
    // 7) Bağsız WO
    check("7. bağsız WO `customers: []`, customerCount 0", !!unlinkedRow && unlinkedRow.customers.length === 0 && unlinkedRow.customerCount === 0);
    // 8) filter[customerId] bağ üzerinden; koparılmış eşleşmez; CSV
    const fA = numsOf(await byFilter(customer.id));
    check("8a ⭐ filter[customerId]=A → bağlı WO var, bağsız YOK", fA.has(woLinkedNo) && !fA.has(woUnlinkedNo));
    const fC = numsOf(await byFilter(custC.id));
    check("8b filter[customerId]=C (koparılmış) → bağlı WO eşleşmez", !fC.has(woLinkedNo));
    const fCsv = numsOf(await byFilter(`${custC.id},${custB.id}`));
    check("8c CSV `C,B` → B üzerinden bağlı WO döner", fCsv.has(woLinkedNo));
    // 9) Rollup saf: >5 distinct → önizleme 5 + toplam; boş/null bağ → 0
    const many = Array.from({ length: 7 }, (_, i) => ({ orderLine: { order: { customer: { id: `c${i}`, name: `M${6 - i}` } } } }));
    const r9 = rollupWorkOrderCustomers([...many, ...many]);
    check(`9. rollup: 14 bağ / 7 distinct → önizleme ${WO_CUSTOMER_PREVIEW} (dizi sırası: M6 ilk — ad sırası DEĞİL) + customerCount 7; null bağ → 0`,
      r9.customers.length === WO_CUSTOMER_PREVIEW && r9.customerCount === 7 && r9.customers[0].name === "M6" && rollupWorkOrderCustomers(undefined).customerCount === 0);
    const damgali = rollupWorkOrderCustomers([
      { createdAt: new Date("2026-01-02T00:00:00Z"), orderLine: { order: { customer: { id: "y", name: "A-sonra" } } } },
      { createdAt: new Date("2026-01-01T00:00:00Z"), orderLine: { order: { customer: { id: "x", name: "Z-once" } } } },
    ]);
    check("9b rollup damgalı: createdAt küçük olan (Z-once) dizi sırasına ve ad sırasına rağmen ÖNCE", damgali.customers[0]?.name === "Z-once");
  } finally {
    await prisma.workOrderToOrderLine.deleteMany({ where: { orderLineId: { in: [orderLineId, ...extraLineIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: [woLinked.id, woUnlinked.id] } } });
    await prisma.order.deleteMany({ where: { id: { in: [order.id, orderB.id, orderC.id, orderD.id] } } }).catch(() => {}); // cascade → lines
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: [customer.id, custB.id, custC.id, custD.id] } } }).catch(() => {});
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
