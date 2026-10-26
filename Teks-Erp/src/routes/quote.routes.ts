// =============================================================================
// SATIŞ TEKLİFİ ROTALARI (/api/quotes) — MAL-4
// =============================================================================
// ⚠️ KAPI TOPLU: `router.use(verifyToken, requireMaliyetEnabled)` (`test_maliyet_regime_gate`). İzinler:
// `quote:read` (liste/detay) · `quote:write` (taslak, kalem, gönder, ret, iptal, revizyon) · `quote:convert`
// (kabul, kabulü geri al, siparişe dönüştür). Maliyet alanları yanıtta yalnız `cost:read` ile (`quoteViewFor`).
// Ekran MAL-5'te; bu dilimde uçlar API'dir.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { SalesQuoteStatus } from "@prisma/client";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireMaliyetEnabled } from "../middlewares/module.middleware";
import { createQuote, getQuote, listQuotes, quoteActors, updateQuoteHeader } from "../services/sales-quote.service";
import { addQuoteLine, deleteQuoteLine, refreshQuoteCosts, updateQuoteLine } from "../services/sales-quote-lines.service";
import { acceptQuote, cancelQuote, rejectQuote, reviseQuote, sendQuote, unacceptQuote } from "../services/sales-quote-transitions.service";
import { convertQuoteToOrder } from "../services/sales-quote-convert.service";
import { quoteViewFor } from "../services/helpers/quote-view.helper";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import { AppError } from "../utils/app-error";

const router = Router();
router.use(verifyToken, requireMaliyetEnabled);

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (h: H) => (req: Request, res: Response, next: NextFunction): void => {
  h(req, res).catch(next);
};

const idParam = z.object({ id: z.string().uuid("Geçersiz teklif ID") });
const lineParam = z.object({ id: z.string().uuid("Geçersiz teklif ID"), lineId: z.string().uuid("Geçersiz kalem ID") });
const body = (req: Request): Record<string, unknown> => z.record(z.string(), z.unknown()).parse(req.body ?? {});
const QUOTE_STATUSES: readonly SalesQuoteStatus[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CANCELLED", "CONVERTED", "SUPERSEDED"];
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Tek yanıt kalıbı: kayıt `quoteViewFor` süzgecinden geçer (maliyet opt-in). */
const sendQuoteJson = (req: Request, res: Response) => (status: number, record: object, extra: Record<string, unknown> = {}) => {
  res.status(status).json({ success: true, data: quoteViewFor(req.user).quote(record), ...extra });
};

/**
 * @openapi
 * /api/quotes:
 *   get:
 *     tags: [Quotes]
 *     summary: Satış teklifleri (süzme sunucuda; özet şeridi durum süzgecinden önceki kümeden)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[durum]", schema: { type: string }, description: "CSV: DRAFT,SENT,…" }
 *       - { in: query, name: "filter[customerId]", schema: { type: string } }
 *       - { in: query, name: "filter[suresiDoldu]", schema: { type: string, enum: ["1", "true"] } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: "{data, ozet, toplamSuzulen, nextCursor}" }
 *       403: { description: Maliyet modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("quote:read"), wrap(async (req, res) => {
  assertNoBareFilterParams(req, ["durum", "customerId", "suresiDoldu"]);
  const f = parseQueryParams(req).filters;
  const statuses = readFilterList(f.durum);
  const bad = statuses.filter((d) => !(QUOTE_STATUSES as readonly string[]).includes(d));
  if (bad.length) throw AppError.badRequest(`Geçersiz teklif durumu: ${bad.join(", ")}`);
  const sd = readFilterList(f.suresiDoldu);
  if (sd.some((v) => v !== "1" && v !== "true")) throw AppError.badRequest("suresiDoldu yalnız 1/true olabilir.");
  const q = listQuery.parse(req.query);
  const out = await listQuotes({ ...q, durum: statuses as SalesQuoteStatus[], customerId: readIdCondition(f.customerId), suresiDoldu: sd.length > 0 });
  const view = quoteViewFor(req.user);
  res.status(200).json({ success: true, ...out, data: out.data.map((r) => view.quote(r)) });
}));

/**
 * @openapi
 * /api/quotes/{id}:
 *   get:
 *     tags: [Quotes]
 *     summary: Teklif detayı (kalemlerle)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "Detay (kalemlerle) + aktorler (geçişi yapan kullanıcı adları)" }
 *       404: { description: Teklif yok }
 */
router.get("/:id", requirePermission("quote:read"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const q = await getQuote(id);
  sendQuoteJson(req, res)(200, q, { aktorler: await quoteActors(q) });
}));

/**
 * @openapi
 * /api/quotes:
 *   post:
 *     tags: [Quotes]
 *     summary: Taslak teklif oluştur (clientToken; numara doğuşta; kur TRY→1 / elle / finans önerisi)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Taslak teklif }
 *       400: { description: "COST_INPUT_MISSING (missing [FX_RATE_MISSING]) · CUSTOMER_ROLE_REQUIRED" }
 *       409: { description: CLIENT_TOKEN_COLLISION }
 */
router.post("/", requirePermission("quote:write"), wrap(async (req, res) => {
  sendQuoteJson(req, res)(201, await createQuote(body(req), req.user?.userId), { message: "Teklif oluşturuldu." });
}));

/**
 * @openapi
 * /api/quotes/{id}:
 *   patch:
 *     tags: [Quotes]
 *     summary: Taslak teklifin başlığını düzenle (yalnız DRAFT)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel teklif }
 *       409: { description: QUOTE_STATUS_CONFLICT (taslak değil) }
 */
router.patch("/:id", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendQuoteJson(req, res)(200, await updateQuoteHeader(id, body(req), req.user?.userId));
}));

/**
 * @openapi
 * /api/quotes/{id}/lines:
 *   post:
 *     tags: [Quotes]
 *     summary: Kalem ekle — ürün (standart sürüm ya da canlı hesap) veya elle yapı; fiyat önerisi tek zincirden
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       201: { description: "Güncel teklif (+warnings: STANDARD_COST_MISSING vb.)" }
 *       400: { description: "COST_INPUT_MISSING · QUOTE_UNIT_UNSUPPORTED" }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.post("/:id/lines", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const out = await addQuoteLine(id, body(req), req.user?.userId);
  sendQuoteJson(req, res)(201, out.quote, { warnings: out.warnings });
}));

/**
 * @openapi
 * /api/quotes/{id}/lines/{lineId}:
 *   patch:
 *     tags: [Quotes]
 *     summary: Kalem düzenle (miktar, fiyat, kâr, renk, metin; yalnız DRAFT)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Güncel teklif }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.patch("/:id/lines/:lineId", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id, lineId } = lineParam.parse(req.params);
  sendQuoteJson(req, res)(200, await updateQuoteLine(id, lineId, body(req), req.user?.userId));
}));

/**
 * @openapi
 * /api/quotes/{id}/lines/{lineId}:
 *   delete:
 *     tags: [Quotes]
 *     summary: Taslak teklifin kalemini sil
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Güncel teklif }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.delete("/:id/lines/:lineId", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id, lineId } = lineParam.parse(req.params);
  sendQuoteJson(req, res)(200, await deleteQuoteLine(id, lineId, req.user?.userId));
}));

/**
 * @openapi
 * /api/quotes/{id}/refresh-costs:
 *   post:
 *     tags: [Quotes]
 *     summary: Maliyeti tazele — kalem maliyetleri yeniden kurulur, elle fiyat korunur (yalnız DRAFT)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel teklif }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.post("/:id/refresh-costs", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const out = await refreshQuoteCosts(id, req.user?.userId);
  sendQuoteJson(req, res)(200, out.quote, { warnings: out.warnings });
}));

// ── GEÇİŞLER ────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/quotes/{id}/send:
 *   post:
 *     tags: [Quotes]
 *     summary: Gönder (DRAFT → SENT; kalemsiz 400)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Gönderildi }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.post("/:id/send", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendQuoteJson(req, res)(200, await sendQuote(id, req.user?.userId), { message: "Teklif gönderildi." });
}));

/**
 * @openapi
 * /api/quotes/{id}/accept:
 *   post:
 *     tags: [Quotes]
 *     summary: Kabul (SENT → ACCEPTED; süresi dolmuşsa 409 QUOTE_EXPIRED)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kabul edildi }
 *       409: { description: "QUOTE_STATUS_CONFLICT · QUOTE_EXPIRED" }
 */
router.post("/:id/accept", requirePermission("quote:convert"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendQuoteJson(req, res)(200, await acceptQuote(id, body(req), req.user?.userId), { message: "Teklif kabul edildi." });
}));

/**
 * @openapi
 * /api/quotes/{id}/unaccept:
 *   post:
 *     tags: [Quotes]
 *     summary: Kabulü geri al (ACCEPTED → SENT; dönüşmemişse)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.post("/:id/unaccept", requirePermission("quote:convert"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendQuoteJson(req, res)(200, await unacceptQuote(id, req.user?.userId), { message: "Kabul geri alındı." });
}));

/**
 * @openapi
 * /api/quotes/{id}/reject:
 *   post:
 *     tags: [Quotes]
 *     summary: Ret (SENT → REJECTED; sebep zorunlu)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Reddedildi }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.post("/:id/reject", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendQuoteJson(req, res)(200, await rejectQuote(id, body(req), req.user?.userId), { message: "Teklif reddedildi." });
}));

/**
 * @openapi
 * /api/quotes/{id}/cancel:
 *   post:
 *     tags: [Quotes]
 *     summary: İptal / geri çek (DRAFT|SENT → CANCELLED)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.post("/:id/cancel", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendQuoteJson(req, res)(200, await cancelQuote(id, body(req), req.user?.userId), { message: "Teklif iptal edildi." });
}));

/**
 * @openapi
 * /api/quotes/{id}/revise:
 *   post:
 *     tags: [Quotes]
 *     summary: Revizyon (SENT|REJECTED → eski SUPERSEDED + yeni DRAFT aynı numara; clientToken)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       201: { description: Yeni revizyon (DRAFT) }
 *       409: { description: "QUOTE_STATUS_CONFLICT · CLIENT_TOKEN_COLLISION" }
 */
router.post("/:id/revise", requirePermission("quote:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendQuoteJson(req, res)(201, await reviseQuote(id, body(req), req.user?.userId), { message: "Revizyon açıldı." });
}));

/**
 * @openapi
 * /api/quotes/{id}/convert:
 *   post:
 *     tags: [Quotes]
 *     summary: Siparişe dönüştür (ACCEPTED → CONVERTED + sipariş tek tx; `order:write` de gerekir; aynı clientToken aynı siparişi döndürür)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [clientToken], properties: { clientToken: { type: string, format: uuid }, lineItems: { type: array, description: "Ürünsüz kaleme yalnız siparişte ürün bağla", items: { type: object, properties: { lineNo: { type: integer }, itemId: { type: string, format: uuid } } } } } } } }
 *     responses:
 *       201: { description: "Sipariş oluşturuldu (data = teklif, orderId, orderNumber)" }
 *       400: { description: QUOTE_LINE_ITEM_MISSING }
 *       403: { description: "PERMISSION_DENIED (details.required: [order:write])" }
 *       409: { description: QUOTE_STATUS_CONFLICT }
 */
router.post("/:id/convert", requirePermission("quote:convert"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const user = { userId: req.user?.userId, permissions: req.user?.permissions };
  const out = await convertQuoteToOrder(id, body(req), user);
  sendQuoteJson(req, res)(out.replay ? 200 : 201, out.quote, { orderId: out.orderId, orderNumber: out.orderNumber, message: "Teklif siparişe dönüştürüldü." });
}));

export default router;
