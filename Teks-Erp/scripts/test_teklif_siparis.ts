// =============================================================================
// test_teklif_siparis — MAL-4 teklif → sipariş dönüşümü (`convertQuoteToOrder`)
// =============================================================================
//   §1 ⭐ iki izin: `order:write` yok → 403 PERMISSION_DENIED `details.required` (rota `quote:convert` yetmez)
//   §2 ürünsüz kalem → 400 QUOTE_LINE_ITEM_MISSING `details.lines[{lineNo,description}]`
//   §3 ACCEPTED dışı (SENT/CONVERTED) → 409 QUOTE_STATUS_CONFLICT
//   §4 ⭐ başarı: sipariş satırları teklifin fiyat/döviz/miktarıyla; teklif CONVERTED + bağ TEKLİFTE
//   §5 ⭐ aynı token replay → aynı sipariş (ikinci sipariş yok); başka teklifte aynı token → 409 çakışma
//   §6 ⭐ paralel iki farklı token → TEK sipariş, kaybeden 409
//   §7 ⭐ `lineItems` eşlemesi (MAL-5): ürünsüz kalem siparişte ürün alır, teklif kalemi DEĞİŞMEZ; ürünlü kaleme eşleme 400
// Çalıştır: npx tsx scripts/test_teklif_siparis.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { convertQuoteToOrder } from "../src/services/sales-quote-convert.service";
import { altinYapiYaz, fiksturKur, fiksturSil } from "./lib/maliyet-fikstur";
import { teklifFiksturKur, teklifFiksturSil, teklifYaz } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
type Hata = { status?: number; code?: string; details?: Record<string, unknown> } | null;
async function hata(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: Record<string, unknown> & { code?: string } };
    return { status: err.statusCode, code: err.details?.code, details: err.details };
  }
}

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_teklif_siparis");
  const m = await fiksturKur("TKS");
  const t = await teklifFiksturKur("TKS");
  try {
    await altinYapiYaz(m);
    const user = { permissions: ["quote:read", "quote:convert", "order:write"] };
    const ok = await teklifYaz(t, "ACCEPTED", { itemId: m.fabricId, lines: 2 });

    const e1 = await hata(() => convertQuoteToOrder(ok, { clientToken: randomUUID() }, { permissions: ["quote:read", "quote:convert"] }));
    const req1 = e1?.details?.required as string[] | undefined;
    check("§1 ⭐ `order:write` yok → 403 PERMISSION_DENIED required[order:write]", e1?.status === 403 && e1.code === "PERMISSION_DENIED" && !!req1?.includes("order:write"), JSON.stringify(e1));

    const noItem = await teklifYaz(t, "ACCEPTED", { itemId: null });
    const e2 = await hata(() => convertQuoteToOrder(noItem, { clientToken: randomUUID() }, user));
    const lines2 = e2?.details?.lines as Array<{ lineNo: number; description: string }> | undefined;
    check("§2 ürünsüz kalem → 400 QUOTE_LINE_ITEM_MISSING lines[]", e2?.status === 400 && e2.code === "QUOTE_LINE_ITEM_MISSING" && lines2?.[0]?.lineNo === 1 && !!lines2[0].description, JSON.stringify(e2));

    const sent = await teklifYaz(t, "SENT", { itemId: m.fabricId });
    const e3 = await hata(() => convertQuoteToOrder(sent, { clientToken: randomUUID() }, user));
    check("§3 SENT → 409 QUOTE_STATUS_CONFLICT", e3?.status === 409 && e3.code === "QUOTE_STATUS_CONFLICT", JSON.stringify(e3));

    const token = randomUUID();
    const out = await convertQuoteToOrder(ok, { clientToken: token }, user);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: out.orderId }, include: { lines: true } });
    const qLines = await prisma.salesQuoteLine.findMany({ where: { quoteId: ok }, orderBy: { lineNo: "asc" } });
    const same = order.lines.length === qLines.length && qLines.every((ql) => order.lines.some((ol) => ol.itemId === ql.itemId && ol.unitPrice?.eq(ql.unitPrice) && ol.quantity.eq(ql.quantity)));
    check("§4a ⭐ sipariş satırları teklifin ürün/miktar/fiyatıyla", same && order.currency === "USD" && order.customerId === t.customerId, `${order.lines.length} satır`);
    check("§4b teklif CONVERTED + bağ teklifte", out.quote.status === "CONVERTED" && out.quote.convertedOrderId === out.orderId && out.quote.convertedAt !== null && !out.replay);

    const again = await convertQuoteToOrder(ok, { clientToken: token }, user);
    const count = await prisma.order.count({ where: { customerId: t.customerId } });
    check("§5a ⭐ aynı token replay → aynı sipariş, ikinci sipariş yok", again.orderId === out.orderId && again.replay && count === 1, `count=${count}`);
    const other = await teklifYaz(t, "ACCEPTED", { itemId: m.fabricId });
    const e5 = await hata(() => convertQuoteToOrder(other, { clientToken: token }, user));
    check("§5b aynı token başka teklif → 409 CLIENT_TOKEN_COLLISION", e5?.status === 409 && e5.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(e5));
    const e5c = await hata(() => convertQuoteToOrder(ok, { clientToken: randomUUID() }, user));
    check("§5c dönüşmüş teklif yeni token → 409", e5c?.status === 409, JSON.stringify(e5c));

    const race = await teklifYaz(t, "ACCEPTED", { itemId: m.fabricId });
    const rs = await Promise.allSettled([convertQuoteToOrder(race, { clientToken: randomUUID() }, user), convertQuoteToOrder(race, { clientToken: randomUUID() }, user)]);
    const won = rs.filter((r) => r.status === "fulfilled").length;
    const lost = rs.filter((r) => r.status === "rejected" && (r.reason as { statusCode?: number }).statusCode === 409).length;
    const linked = await prisma.salesQuote.findUniqueOrThrow({ where: { id: race }, select: { convertedOrderId: true } });
    const count2 = await prisma.order.count({ where: { customerId: t.customerId } });
    check("§6 ⭐ paralel iki token → tek sipariş, kaybeden 409", won === 1 && lost === 1 && !!linked.convertedOrderId && count2 === 2, `won=${won} lost=${lost} count=${count2}`);

    const fresh = await teklifYaz(t, "ACCEPTED", { itemId: m.fabricId });
    const e7a = await hata(() => convertQuoteToOrder(fresh, { clientToken: randomUUID(), lineItems: [{ lineNo: 1, itemId: m.fabricId }] }, user));
    check("§7a ürünlü kaleme eşleme → 400 (teklifteki ürün değişmez)", e7a?.status === 400, JSON.stringify(e7a));
    const mapped = await convertQuoteToOrder(noItem, { clientToken: randomUUID(), lineItems: [{ lineNo: 1, itemId: m.fabricId }] }, user);
    const mOrder = await prisma.order.findUniqueOrThrow({ where: { id: mapped.orderId }, select: { lines: { select: { itemId: true } } } });
    const mLine = await prisma.salesQuoteLine.findFirstOrThrow({ where: { quoteId: noItem, lineNo: 1 }, select: { itemId: true } });
    check("§7b ⭐ yeni desen kalemi siparişte eşlenen ürünle; teklif kalemi ürünsüz kalır (defter)", mOrder.lines[0]?.itemId === m.fabricId && mLine.itemId === null && mapped.quote.status === "CONVERTED");
  } finally {
    await teklifFiksturSil(t);
    await fiksturSil(m);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
