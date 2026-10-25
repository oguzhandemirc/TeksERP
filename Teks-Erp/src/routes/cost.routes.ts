// =============================================================================
// MALİYET GİRDİLERİ ROTALARI (/api/cost) — MAL-1
// =============================================================================
// ⚠️ KAPI TOPLU: `router.use(verifyToken, requireMaliyetEnabled)` — uç uç yazılırsa biri
// unutulur ve modül kapalı fabrikada açık kalır (`test_maliyet_regime_gate`). İzinler:
// `cost:read` (TUTAR görme) · `cost:write` (yapı, iplik fiyatı, tarife) · `cost:settings`
// (tesis parametreleri). Ekran yok (MAL-3/MAL-7); uçlar bu dilimde API'dir.
// ⚠️ YOL SIRASI: sabit alt yollar (`/active`, `/draft`) `/:id`ten ÖNCE.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireMaliyetEnabled } from "../middlewares/module.middleware";
import {
  activateDraft,
  createDraft,
  deleteDraft,
  getParameterSetByStatus,
  listParameterSets,
  updateDraft,
} from "../services/cost-parameter.service";
import { changeYarnCostPrice, listYarnCostPrices, revokeYarnCostPrice } from "../services/yarn-cost-price.service";
import { changeFinishingRate, listFinishingRates, revokeFinishingRate } from "../services/finishing-rate.service";
import { getCostStructure, putCostStructure } from "../services/cost-structure.service";

const router = Router();
router.use(verifyToken, requireMaliyetEnabled);

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (h: H) => (req: Request, res: Response, next: NextFunction): void => {
  h(req, res).catch(next);
};

const idParam = z.object({ id: z.string().uuid("Geçersiz kayıt ID") });
const itemIdParam = z.object({ itemId: z.string().uuid("Geçersiz ürün ID") });
const currencyEnum = z.enum(["TRY", "USD", "EUR", "GBP", "RUB"], { message: "Geçersiz para birimi" });
// Sayı metin ya da sayı gelir; Decimal'e çevirme + aralık servis tarafında (`cost-input.helper`).
const decimalInput = z.union([z.string(), z.number()]);
const body = z.record(z.string(), z.unknown());
// Geçmiş açıkça istenir; tanınmayan değer 400 (fail-closed).
const includeRevokedQ = z
  .enum(["0", "1", "true", "false"], { message: "includeRevoked yalnız 0/1/true/false olabilir" })
  .optional()
  .transform((v) => v === "1" || v === "true");

const yarnPriceSchema = z.object({
  yarnItemId: z.string().uuid("Geçersiz iplik ID"),
  currency: currencyEnum,
  pricePerKg: decimalInput,
  source: z.enum(["MANUAL", "LAST_RECEIPT", "PURCHASE_PRICE"], { message: "Geçersiz fiyat kaynağı" }).optional(),
  sourceRef: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
}).strict();

const finishingRateSchema = z.object({
  code: z.string(),
  name: z.string(),
  subcontractorId: z.string().uuid("Geçersiz fason firma ID").nullable().optional(),
  basis: z.enum(["RAW_M", "FINISHED_M"], { message: "Tarife bazı HAM ya da MAMUL metre olmalı" }),
  currency: currencyEnum,
  pricePerM: decimalInput,
  typicalShrinkPct: decimalInput.nullable().optional(),
  note: z.string().nullable().optional(),
}).strict();

// ── PARAMETRE SETLERİ ────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/cost/parameter-sets:
 *   get:
 *     tags: [Cost]
 *     summary: Tesis maliyet parametre setleri (tüm sürümler, yeniden eskiye)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Maliyet modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/parameter-sets", requirePermission("cost:read"), wrap(async (_req, res) => {
  res.status(200).json({ success: true, data: await listParameterSets() });
}));

/**
 * @openapi
 * /api/cost/parameter-sets/active:
 *   get:
 *     tags: [Cost]
 *     summary: Yürürlükteki parametre seti (yoksa data null)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kayıt ya da null }
 */
router.get("/parameter-sets/active", requirePermission("cost:read"), wrap(async (_req, res) => {
  res.status(200).json({ success: true, data: await getParameterSetByStatus("ACTIVE") });
}));

/**
 * @openapi
 * /api/cost/parameter-sets/draft:
 *   get:
 *     tags: [Cost]
 *     summary: Açık taslak parametre seti (yoksa data null)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kayıt ya da null }
 */
router.get("/parameter-sets/draft", requirePermission("cost:read"), wrap(async (_req, res) => {
  res.status(200).json({ success: true, data: await getParameterSetByStatus("DRAFT") });
}));

/**
 * @openapi
 * /api/cost/parameter-sets:
 *   post:
 *     tags: [Cost]
 *     summary: Taslak aç (yürürlükteki setin kopyası + gövdedeki değişiklikler)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Taslak oluşturuldu }
 *       400: { description: Aralık dışı değer ya da ilk taslakta eksik zorunlu alan }
 *       409: { description: Zaten açık bir taslak var }
 */
router.post("/parameter-sets", requirePermission("cost:settings"), wrap(async (req, res) => {
  const data = await createDraft(body.parse(req.body ?? {}), req.user?.userId);
  res.status(201).json({ success: true, data, message: "Taslak parametre seti açıldı." });
}));

/**
 * @openapi
 * /api/cost/parameter-sets/{id}:
 *   patch:
 *     tags: [Cost]
 *     summary: Taslağı güncelle (yürürlükteki set değişmez → 409)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: Set taslak değil }
 */
router.patch("/parameter-sets/:id", requirePermission("cost:settings"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = await updateDraft(id, body.parse(req.body ?? {}), req.user?.userId);
  res.status(200).json({ success: true, data, message: "Taslak güncellendi." });
}));

/**
 * @openapi
 * /api/cost/parameter-sets/{id}/activate:
 *   post:
 *     tags: [Cost]
 *     summary: Taslağı yürürlüğe al (eski yürürlükteki SUPERSEDED olur)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Yürürlüğe alındı }
 *       409: { description: Set taslak değil ya da eşzamanlı yürürlüğe alma }
 */
router.post("/parameter-sets/:id/activate", requirePermission("cost:settings"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = await activateDraft(id, req.user?.userId);
  res.status(200).json({ success: true, data, message: `Parametre seti v${data.versionNo} yürürlüğe alındı.` });
}));

/**
 * @openapi
 * /api/cost/parameter-sets/{id}:
 *   delete:
 *     tags: [Cost]
 *     summary: Taslağı sil (yalnız hiç yürürlüğe girmemiş taslak)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Silindi }
 *       409: { description: Yürürlükteki/eski set silinemez }
 */
router.delete("/parameter-sets/:id", requirePermission("cost:settings"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await deleteDraft(id, req.user?.userId), message: "Taslak silindi." });
}));

// ── İPLİK MALİYET FİYATLARI ──────────────────────────────────────────────────

/**
 * @openapi
 * /api/cost/yarn-prices:
 *   get:
 *     tags: [Cost]
 *     summary: İplik maliyet fiyatları (varsayılan yalnız aktif; includeRevoked=1 geçmiş)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 */
router.get("/yarn-prices", requirePermission("cost:read"), wrap(async (req, res) => {
  const q = z.object({ yarnItemId: z.string().uuid("Geçersiz iplik ID").optional(), includeRevoked: includeRevokedQ }).parse(req.query);
  res.status(200).json({ success: true, data: await listYarnCostPrices(q) });
}));

/**
 * @openapi
 * /api/cost/yarn-prices:
 *   post:
 *     tags: [Cost]
 *     summary: İplik maliyet fiyatı yaz/değiştir (eski fiyat damgalanır, yeni satır doğar)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yazıldı ya da değer aynı (wrote=false) }
 *       400: { description: İplik değil / fiyat ≤ 0 }
 *       409: { description: Eşzamanlı değişim }
 */
router.post("/yarn-prices", requirePermission("cost:write"), wrap(async (req, res) => {
  const input = yarnPriceSchema.parse(req.body ?? {});
  const r = await changeYarnCostPrice(input, req.user?.userId);
  res.status(200).json({ success: true, data: { ...r.row, wrote: r.wrote, previousId: r.previousId }, message: r.wrote ? "İplik fiyatı kaydedildi." : "Fiyat zaten bu değerde — değişiklik yapılmadı." });
}));

/**
 * @openapi
 * /api/cost/yarn-prices/{id}/revoke:
 *   post:
 *     tags: [Cost]
 *     summary: İplik fiyatını kaldır (satır silinmez, damgalanır)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       409: { description: Zaten kaldırılmış }
 */
router.post("/yarn-prices/:id/revoke", requirePermission("cost:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await revokeYarnCostPrice(id, req.user?.userId), message: "İplik fiyatı kaldırıldı." });
}));

// ── TERBİYE / FASON TARİFELERİ ───────────────────────────────────────────────

/**
 * @openapi
 * /api/cost/finishing-rates:
 *   get:
 *     tags: [Cost]
 *     summary: Terbiye/fason tarifeleri (varsayılan yalnız aktif; includeRevoked=1 geçmiş)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 */
router.get("/finishing-rates", requirePermission("cost:read"), wrap(async (req, res) => {
  const q = z.object({ code: z.string().max(32).optional(), includeRevoked: includeRevokedQ }).parse(req.query);
  res.status(200).json({ success: true, data: await listFinishingRates(q) });
}));

/**
 * @openapi
 * /api/cost/finishing-rates:
 *   post:
 *     tags: [Cost]
 *     summary: Tarife yaz/değiştir (aynı kodla yeni sürüm; eski sürüm damgalanır)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yazıldı ya da değerler aynı (wrote=false) }
 *       409: { description: Eşzamanlı değişim }
 */
router.post("/finishing-rates", requirePermission("cost:write"), wrap(async (req, res) => {
  const input = finishingRateSchema.parse(req.body ?? {});
  const r = await changeFinishingRate(input, req.user?.userId);
  res.status(200).json({ success: true, data: { ...r.row, wrote: r.wrote, previousId: r.previousId }, message: r.wrote ? "Tarife kaydedildi." : "Tarife zaten bu değerlerde — değişiklik yapılmadı." });
}));

/**
 * @openapi
 * /api/cost/finishing-rates/{id}/revoke:
 *   post:
 *     tags: [Cost]
 *     summary: Tarifeyi kaldır (satır silinmez, damgalanır)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       409: { description: Zaten kaldırılmış }
 */
router.post("/finishing-rates/:id/revoke", requirePermission("cost:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await revokeFinishingRate(id, req.user?.userId), message: "Tarife kaldırıldı." });
}));

// ── ÜRÜN MALİYET YAPISI ──────────────────────────────────────────────────────

/**
 * @openapi
 * /api/cost/structures/{itemId}:
 *   get:
 *     tags: [Cost]
 *     summary: Kumaşın maliyet yapısı (yoksa structure null)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: itemId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Yapı }
 *       404: { description: Ürün yok }
 */
router.get("/structures/:itemId", requirePermission("cost:read"), wrap(async (req, res) => {
  const { itemId } = itemIdParam.parse(req.params);
  res.status(200).json({ success: true, data: await getCostStructure(itemId) });
}));

/**
 * @openapi
 * /api/cost/structures/{itemId}:
 *   put:
 *     tags: [Cost]
 *     summary: Kumaşın maliyet yapısını yaz (tam küme; boş alan = parametre varsayılanı)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: itemId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Yazıldı }
 *       400: { description: Ürün KUMAŞ değil / bilinmeyen tarife kodu / aralık dışı değer }
 */
router.put("/structures/:itemId", requirePermission("cost:write"), wrap(async (req, res) => {
  const { itemId } = itemIdParam.parse(req.params);
  const data = await putCostStructure(itemId, body.parse(req.body ?? {}), req.user?.userId);
  res.status(200).json({ success: true, data, message: "Maliyet yapısı kaydedildi." });
}));

export default router;
