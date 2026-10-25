// =============================================================================
// FİYAT LİSTESİ ROTALARI (/api/price-lists) — MAL-4
// =============================================================================
// ⚠️ KAPI TOPLU: `router.use(verifyToken, requireMaliyetEnabled)` (`test_maliyet_regime_gate`). İzinler:
// `price-list:read` · `price-list:write`. Satırdaki maliyet/kâr alanları yalnız `cost:read` ile (`quoteViewFor`).
// Ekran MAL-5'te; bu dilimde uçlar API'dir.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Currency, PriceListStatus } from "@prisma/client";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireMaliyetEnabled } from "../middlewares/module.middleware";
import {
  archivePriceList,
  createPriceList,
  fillFromStandardCost,
  getPriceList,
  listPriceLists,
  publishPriceList,
  replacePriceListLines,
  revisePriceList,
  updatePriceList,
} from "../services/price-list.service";
import { quoteViewFor } from "../services/helpers/quote-view.helper";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import { AppError } from "../utils/app-error";

const router = Router();
router.use(verifyToken, requireMaliyetEnabled);

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (h: H) => (req: Request, res: Response, next: NextFunction): void => {
  h(req, res).catch(next);
};

const idParam = z.object({ id: z.string().uuid("Geçersiz fiyat listesi ID") });
const body = (req: Request): Record<string, unknown> => z.record(z.string(), z.unknown()).parse(req.body ?? {});
const STATUSES: readonly PriceListStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];
const CURRENCIES: readonly Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const sendList = (req: Request, res: Response) => (status: number, record: object, message?: string) => {
  res.status(status).json({ success: true, data: quoteViewFor(req.user).priceList(record), ...(message ? { message } : {}) });
};

/**
 * @openapi
 * /api/price-lists:
 *   get:
 *     tags: [PriceLists]
 *     summary: Fiyat listeleri (süzme sunucuda)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[durum]", schema: { type: string }, description: "CSV: DRAFT,PUBLISHED,ARCHIVED" }
 *       - { in: query, name: "filter[customerId]", schema: { type: string } }
 *       - { in: query, name: "filter[genel]", schema: { type: string, enum: ["1", "true"] } }
 *       - { in: query, name: "filter[currency]", schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: "{data, ozet, toplamSuzulen, nextCursor}" }
 *       403: { description: Maliyet modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("price-list:read"), wrap(async (req, res) => {
  assertNoBareFilterParams(req, ["durum", "customerId", "genel", "currency"]);
  const f = parseQueryParams(req).filters;
  const statuses = readFilterList(f.durum);
  if (statuses.some((d) => !(STATUSES as readonly string[]).includes(d))) throw AppError.badRequest("Geçersiz liste durumu.");
  const currency = readFilterList(f.currency);
  if (currency.some((c) => !(CURRENCIES as readonly string[]).includes(c))) throw AppError.badRequest("Geçersiz para birimi.");
  const genel = readFilterList(f.genel);
  if (genel.some((v) => v !== "1" && v !== "true")) throw AppError.badRequest("genel yalnız 1/true olabilir.");
  const q = listQuery.parse(req.query);
  const out = await listPriceLists({ ...q, durum: statuses as PriceListStatus[], currency: currency as Currency[], genel: genel.length > 0, customerId: readIdCondition(f.customerId) });
  res.status(200).json({ success: true, ...out });
}));

/**
 * @openapi
 * /api/price-lists/{id}:
 *   get:
 *     tags: [PriceLists]
 *     summary: Fiyat listesi detayı (satırlarla)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Detay }
 *       404: { description: Liste yok }
 */
router.get("/:id", requirePermission("price-list:read"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendList(req, res)(200, await getPriceList(id));
}));

/**
 * @openapi
 * /api/price-lists:
 *   post:
 *     tags: [PriceLists]
 *     summary: Taslak fiyat listesi (müşterisiz = genel; clientToken; numara doğuşta)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Taslak liste }
 *       409: { description: CLIENT_TOKEN_COLLISION }
 */
router.post("/", requirePermission("price-list:write"), wrap(async (req, res) => {
  sendList(req, res)(201, await createPriceList(body(req), req.user?.userId), "Fiyat listesi oluşturuldu.");
}));

/**
 * @openapi
 * /api/price-lists/{id}:
 *   patch:
 *     tags: [PriceLists]
 *     summary: Taslağın başlığını düzenle (yalnız DRAFT)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel liste }
 *       409: { description: PRICE_LIST_STATUS_CONFLICT }
 */
router.patch("/:id", requirePermission("price-list:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendList(req, res)(200, await updatePriceList(id, body(req), req.user?.userId));
}));

/**
 * @openapi
 * /api/price-lists/{id}/lines:
 *   put:
 *     tags: [PriceLists]
 *     summary: Taslağın satırlarını bütünüyle yaz (yayınlı liste 409)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel liste }
 *       400: { description: PRICE_LIST_DUPLICATE_LINE }
 *       409: { description: PRICE_LIST_STATUS_CONFLICT }
 */
router.put("/:id/lines", requirePermission("price-list:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendList(req, res)(200, await replacePriceListLines(id, body(req), req.user?.userId));
}));

/**
 * @openapi
 * /api/price-lists/{id}/fill-from-standard-cost:
 *   post:
 *     tags: [PriceLists]
 *     summary: Standart maliyetten doldur (aktif sürüm × (1 + kâr) / kur, 2 hane; yalnız DRAFT)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel liste }
 *       400: { description: "COST_INPUT_MISSING (FX_RATE_MISSING · STANDARD_COST_MISSING · PARAMETER_SET_MISSING)" }
 *       409: { description: PRICE_LIST_STATUS_CONFLICT }
 */
router.post("/:id/fill-from-standard-cost", requirePermission("price-list:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendList(req, res)(200, await fillFromStandardCost(id, body(req), req.user?.userId));
}));

/**
 * @openapi
 * /api/price-lists/{id}/publish:
 *   post:
 *     tags: [PriceLists]
 *     summary: Yayınla (aynı müşteri+dövizin yayınlısı ARCHIVED, tek tx)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Yayınlandı }
 *       409: { description: PRICE_LIST_STATUS_CONFLICT }
 */
router.post("/:id/publish", requirePermission("price-list:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendList(req, res)(200, await publishPriceList(id, req.user?.userId), "Fiyat listesi yayınlandı.");
}));

/**
 * @openapi
 * /api/price-lists/{id}/archive:
 *   post:
 *     tags: [PriceLists]
 *     summary: Arşivle (PUBLISHED → ARCHIVED)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Arşivlendi }
 *       409: { description: PRICE_LIST_STATUS_CONFLICT }
 */
router.post("/:id/archive", requirePermission("price-list:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendList(req, res)(200, await archivePriceList(id, req.user?.userId), "Fiyat listesi arşivlendi.");
}));

/**
 * @openapi
 * /api/price-lists/{id}/revise:
 *   post:
 *     tags: [PriceLists]
 *     summary: Revizyon (yayınlı/arşivli listeden yeni DRAFT, aynı numara; clientToken)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       201: { description: Yeni revizyon }
 *       409: { description: "PRICE_LIST_STATUS_CONFLICT · CLIENT_TOKEN_COLLISION" }
 */
router.post("/:id/revise", requirePermission("price-list:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  sendList(req, res)(201, await revisePriceList(id, body(req), req.user?.userId), "Revizyon açıldı.");
}));

export default router;
