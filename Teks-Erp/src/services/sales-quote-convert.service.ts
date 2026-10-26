// =============================================================================
// TEKLİF → SİPARİŞ DÖNÜŞTÜRME (MAL-4; plan §4.3 adım 5)
// =============================================================================
// İki izin: rota `quote:convert`, servis ayrıca `order:write` ister (sipariş doğuran yetenek; yoksa 403
// PERMISSION_DENIED `details.required`). Ürünsüz kalem 400 QUOTE_LINE_ITEM_MISSING. Sipariş kapıları
// `prepareOrderCreate`ten (tx dışı), yazım TEK tx'te: ① 8036 token kilidi + replay (tx'in İLK ifadesi) →
// ② `insertPreparedOrderTx` (8030 kart kilitleri) → ③ teklif claim'i ACCEPTED → CONVERTED + bağ. Kilit
// sırası gelen kutusu emsaliyle aynı (8036 → 8030); teklif claim'i satır kilidi, advisory değil.
// Bağ TEKLİFTE (`convertedOrderId`); `Order`a kolon yok. Replay: aynı token → aynı sipariş (dört durumlu boğaz).
// MAL-5: ürünsüz ("yeni desen") kaleme ürün `lineItems[{lineNo,itemId}]` ile YALNIZ siparişte bağlanır —
// kabul edilmiş teklif defterdir, kalemi değişmez.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { claimQuoteTx, quoteClaimError } from "./helpers/sales-quote-state.helper";
import { assertOrderReplayAlive, tokenReplay } from "./helpers/token-replay.helper";
import { auditQuoteStatus, QUOTE_INCLUDE, readQuoteToken, type QuoteRecord } from "./sales-quote-transitions.service";
import type { OrderStatus } from "@prisma/client";

async function orderService() {
  return (await import("../routes/order.routes")).orderService;
}

const MAX_LINE_ITEMS = 200;

/** `lineItems` → kalem no → ürün; yalnız ürünsüz kalem bağlanır (ürünlü kalemin ürünü teklifte donmuştur). */
function readLineItems(raw: unknown, lines: ReadonlyArray<{ lineNo: number; itemId: string | null }>): Map<number, string> {
  const out = new Map<number, string>();
  if (raw === undefined || raw === null) return out;
  if (!Array.isArray(raw) || raw.length > MAX_LINE_ITEMS) throw AppError.badRequest("Ürün eşlemesi (lineItems) dizi olmalı.");
  for (const e of raw as Array<Record<string, unknown> | null>) {
    const lineNo = e?.lineNo;
    const itemId = e?.itemId;
    if (typeof lineNo !== "number" || !Number.isInteger(lineNo) || typeof itemId !== "string" || !/^[0-9a-f-]{36}$/i.test(itemId)) {
      throw AppError.badRequest("Ürün eşlemesinde kalem no ve ürün zorunlu.");
    }
    const line = lines.find((l) => l.lineNo === lineNo);
    if (!line) throw AppError.badRequest(`${lineNo}. kalem teklifte yok.`);
    if (line.itemId) throw AppError.badRequest(`${lineNo}. kalemin ürünü teklifte zaten bağlı; değiştirilemez.`);
    out.set(lineNo, itemId);
  }
  return out;
}

export interface ConvertResult { quote: QuoteRecord; orderId: string; orderNumber: string | null; replay: boolean }

type OrderWithQuote = { id: string; status: OrderStatus; orderNumber: string | null; convertedFromQuote: { id: string } | null };

function convertReplay(quoteId: string) {
  return tokenReplay<OrderWithQuote, ConvertResult>({
    find: (db, clientToken) =>
      db.order.findUnique({ where: { clientToken }, select: { id: true, status: true, orderNumber: true, convertedFromQuote: { select: { id: true } } } }),
    alive: (p) => assertOrderReplayAlive({ id: p.id, status: p.status, orderNumber: p.orderNumber }),
    identity: (p) => [{ ad: "quoteId", mevcut: p.convertedFromQuote?.id ?? null, gelen: quoteId }],
    collision: (p) => `Bu form daha önce başka bir sipariş için kullanılmış (${p.orderNumber ?? "-"}). Formu yeniden açın.`,
    respond: async (p) => ({ quote: await prisma.salesQuote.findUniqueOrThrow({ where: { id: quoteId }, include: QUOTE_INCLUDE }), orderId: p.id, orderNumber: p.orderNumber, replay: true }),
  });
}

/** `POST /api/quotes/:id/convert {clientToken}` — kabul edilmiş teklif → sipariş (tek tx). */
export async function convertQuoteToOrder(quoteId: string, body: { clientToken?: unknown; lineItems?: unknown }, user: { userId?: string; permissions?: string[] }): Promise<ConvertResult> {
  if (!matchesPermission(user.permissions ?? [], "order:write")) {
    throw AppError.forbidden("Teklifi siparişe dönüştürmek için sipariş yazma izni de gerekir.", { code: "PERMISSION_DENIED", required: ["order:write"] });
  }
  const clientToken = readQuoteToken(body.clientToken);
  const replay = convertReplay(quoteId);
  return replay.run(clientToken, async () => {
    const q = await prisma.salesQuote.findUnique({ where: { id: quoteId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    if (!q) throw AppError.notFound("Teklif bulunamadı.");
    if (q.status !== "ACCEPTED") throw await quoteClaimError(prisma, quoteId, "convert");
    const linked = readLineItems(body.lineItems, q.lines);
    const missing = q.lines.filter((l) => !l.itemId && !linked.has(l.lineNo)).map((l) => ({ lineNo: l.lineNo, description: l.description }));
    if (missing.length) {
      throw AppError.badRequest("Ürünü bağlanmamış kalem var; siparişe dönüştürmeden önce kaleme ürün seçin.", { code: "QUOTE_LINE_ITEM_MISSING", lines: missing });
    }
    if (q.lines.length === 0) throw AppError.badRequest("Kalemsiz teklif siparişe dönüştürülemez.");
    const data: Record<string, unknown> = {
      customerId: q.customerId,
      ...(q.branchId ? { branchId: q.branchId } : {}),
      currency: q.currency,
      clientToken,
      lines: q.lines.map((l) => ({
        itemId: l.itemId ?? linked.get(l.lineNo), ...(l.colorId ? { colorId: l.colorId } : {}), quantity: l.quantity.toNumber(), unit: l.unit,
        unitPrice: l.unitPrice.toNumber(), ...(l.width ? { width: l.width.toNumber() } : {}),
      })),
    };
    const svc = await orderService();
    const prepared = await svc.prepareOrderCreate(data, clientToken, { userId: user.userId });
    const r = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const replayed = await replay.inTx(tx, clientToken);
          if (replayed) return { replayed };
          const order = await svc.insertPreparedOrderTx(tx, prepared);
          const now = new Date();
          await claimQuoteTx(tx, quoteId, "convert", {
            data: { convertedOrderId: order.id as string, convertedAt: now, convertedById: user.userId ?? null, updatedById: user.userId ?? null },
            extra: { convertedOrderId: null },
          });
          return { order };
        }),
      undefined,
      (e) => !isClientTokenP2002(e),
    );
    if ("replayed" in r && r.replayed) return r.replayed;
    const order = (r as { order: Record<string, unknown> }).order;
    await svc.finishOrderCreate(order, data, prepared, { auditExtra: { kaynak: "TEKLIF", quoteId, quoteNo: q.quoteNo, revisionNo: q.revisionNo } });
    auditQuoteStatus(quoteId, { from: "ACCEPTED", to: "CONVERTED", userId: user.userId, extra: { convertedOrderId: order.id } });
    return {
      quote: await prisma.salesQuote.findUniqueOrThrow({ where: { id: quoteId }, include: QUOTE_INCLUDE }),
      orderId: order.id as string,
      orderNumber: (order.orderNumber as string | null) ?? null,
      replay: false,
    };
  });
}
