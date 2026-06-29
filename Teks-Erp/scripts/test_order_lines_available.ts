// =============================================================================
// TEST: /orders/order-lines/available iki-modlu (legacy + cursor) — sipariş-önce
// Çalıştır: npx tsx scripts/test_order_lines_available.ts
// =============================================================================
// Kapsam:
//   1) Geriye-uyum: {itemId} (limit yok) → eski ApiResponse şekli, açık>0, itemId-filtreli, createdAt asc.
//   2) Legacy itemId zorunlu: {} (limit/itemId yok) → 400 (throw).
//   3) Cursor: {search, limit:2} ardışık cursor'lar TÜM açık kalemleri ATLAMASIZ/TEKRARSIZ kapsar;
//      kapalı (shippedQty=quantity) satır araya serpiştirilince sayfa boyutu=limit kalır (E1 regresyon).
//   4) Arama: orderNumber + customerName.
//   5) withTotal cursor: totalEstimate doğru; netOpenQty dolu.
//   6) Legacy withInProduction: netOpenQty hesaplanır (E2 — itemId varken).
// =============================================================================

import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import type { CursorPaginatedResponse } from "../src/services/base.service";
import type { ApiResponse } from "../src/types/api.types";

const svc = new OrderService({ modelName: "order", tableName: "ORDER", searchFields: ["orderNumber"] });

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

type Line = { lineId: string; openQty: unknown; netOpenQty?: unknown; orderNumber: string };
const asLines = (r: unknown): Line[] => ((r as ApiResponse<Line[]>).data ?? []) as Line[];

let ITEM = "", ADMIN = "", CUSTOMER = "";
const orderIds: string[] = [];
const openLineIds: string[] = [];
let closedLineId = "";
const stamp = `${Date.now()}`.slice(-7);
const PREFIX = `TEST-QOF-ORD-${stamp}`;
let n = 0;

async function makeOrderLine(shipped: number): Promise<string> {
  n++;
  const order = await prisma.order.create({
    data: {
      orderNumber: `${PREFIX}-${n}`,
      customerId: CUSTOMER,
      status: "APPROVED",
      lines: { create: [{ itemId: ITEM, colorId: null, width: 250, quantity: 100, shippedQty: shipped }] },
    },
    include: { lines: { select: { id: true } } },
  });
  orderIds.push(order.id);
  return order.lines[0].id;
}

async function main(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`fixture: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const cust = await prisma.customer.create({ data: { code: `TEST-QOF-${stamp}`.slice(0, 32), name: `TEST-QOF Müşteri ${stamp}` }, select: { id: true } });
  CUSTOMER = cust.id;

  try {
    // 5 açık + 1 kapalı (3. sırada, createdAt-ortada) — interleave testi
    openLineIds.push(await makeOrderLine(0));
    openLineIds.push(await makeOrderLine(0));
    closedLineId = await makeOrderLine(100); // kapalı: quantity===shippedQty
    openLineIds.push(await makeOrderLine(0));
    openLineIds.push(await makeOrderLine(0));
    openLineIds.push(await makeOrderLine(0));

    // === 1) Geriye-uyum (legacy, itemId) ===
    console.log("\n=== 1) Legacy {itemId} geriye-uyum ===");
    {
      const r = await svc.findAvailableOrderLines({ itemId: ITEM });
      const lines = asLines(r);
      const mine = lines.filter((l) => l.orderNumber.startsWith(PREFIX));
      check("legacy: ApiResponse.data dizi", Array.isArray(lines));
      check("legacy: tüm dönenler açık>0", lines.every((l) => Number(l.openQty) > 0));
      check("legacy: 5 açık kalemim döndü", mine.length === 5, `mine=${mine.length}`);
      check("legacy: kapalı kalem YOK", !lines.some((l) => l.lineId === closedLineId));
    }

    // === 2) Legacy itemId zorunlu ===
    console.log("\n=== 2) Legacy itemId zorunlu ===");
    {
      let threw = false;
      try { await svc.findAvailableOrderLines({}); } catch { threw = true; }
      check("itemId yok + limit yok → 400/throw", threw);
    }

    // === 3) Cursor paging — atlamasız/tekrarsız + E1 (kapalı serpiştirme) ===
    console.log("\n=== 3) Cursor paging (limit:2, search prefix) ===");
    {
      const seen = new Set<string>();
      const pageSizes: number[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const r = (await svc.findAvailableOrderLines({ search: PREFIX, limit: 2, cursor })) as CursorPaginatedResponse<Line>;
        const data = r.data as Line[];
        pageSizes.push(data.length);
        for (const l of data) seen.add(l.lineId);
        cursor = r.pagination.hasMore ? r.pagination.nextCursor : null;
      } while (cursor && ++guard < 20);
      check("cursor: tüm 5 açık kalem kapsandı (atlamasız)", openLineIds.every((id) => seen.has(id)) && seen.size === 5, `seen=${seen.size}`);
      check("cursor: kapalı kalem kapsanmadı", !seen.has(closedLineId));
      // E1: kapalı satır ortada olmasına rağmen son-olmayan sayfalar tam (=limit)
      const nonLast = pageSizes.slice(0, -1);
      check("cursor: son-olmayan sayfalar tam dolu (E1)", nonLast.every((s) => s === 2), `pages=${pageSizes.join(",")}`);
    }

    // === 4) Arama (orderNumber + customer) ===
    console.log("\n=== 4) Arama ===");
    {
      const byOrder = (await svc.findAvailableOrderLines({ search: `${PREFIX}-1`, limit: 50 })) as CursorPaginatedResponse<Line>;
      check("arama orderNumber → eşleşen kalem", (byOrder.data as Line[]).some((l) => l.lineId === openLineIds[0]));
      const byCust = (await svc.findAvailableOrderLines({ search: `TEST-QOF Müşteri ${stamp}`, limit: 50 })) as CursorPaginatedResponse<Line>;
      check("arama customerName → kalemlerim", (byCust.data as Line[]).filter((l) => l.orderNumber.startsWith(PREFIX)).length === 5);
    }

    // === 5) withTotal + netOpenQty ===
    console.log("\n=== 5) withTotal cursor ===");
    {
      const r = (await svc.findAvailableOrderLines({ search: PREFIX, limit: 50, withTotal: true })) as CursorPaginatedResponse<Line>;
      check("withTotal: totalEstimate=5", r.pagination.totalEstimate === 5, `total=${r.pagination.totalEstimate}`);
      check("cursor: netOpenQty dolu", (r.data as Line[]).every((l) => l.netOpenQty != null && Number(l.netOpenQty) === 100));
    }

    // === 6) Legacy withInProduction (E2 — itemId varken hesaplanır) ===
    console.log("\n=== 6) Legacy withInProduction ===");
    {
      const r = await svc.findAvailableOrderLines({ itemId: ITEM, withInProduction: true });
      const mine = asLines(r).filter((l) => l.orderNumber.startsWith(PREFIX));
      check("legacy+withInProduction: netOpenQty dolu", mine.length === 5 && mine.every((l) => l.netOpenQty != null));
    }
  } finally {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }); // lines cascade
    await prisma.customer.deleteMany({ where: { id: CUSTOMER } }).catch(() => undefined);
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  void ADMIN;
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
