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
import { changeMachineCostRate, createMachineCostRate, listMachineCostOptions, listMachineCostRates, revokeMachineCostRate } from "../services/machine-cost-rate.service";
import { changeConsumableNorm, createConsumableNorm, listConsumableNorms, revokeConsumableNorm } from "../services/consumable-norm.service";
import { previewCost } from "../services/cost-calc.service";
import { getDispatchFinishingCheck } from "../services/dispatch-finishing-check.service";
import { suggestQuoteCurrency } from "../services/quote-currency.service";
import {
  createStandardCostVersion,
  getCostItem,
  getStandardCostVersion,
  listCostItems,
  listStandardCostVersions,
  restoreStandardCostVersion,
  type StructureStatus,
} from "../services/standard-cost.service";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import { AppError } from "../utils/app-error";

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
  // SY-E1: KG = boyahane kilo ücreti; `pricePerM` kolonu "tabanın birimi başına" okunur (veri sözleşmesi korunur).
  basis: z.enum(["RAW_M", "FINISHED_M", "KG"], { message: "Tarife bazı HAM metre, MAMUL metre ya da KİLO olmalı" }),
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

// ── MAKİNE SAAT ÜCRETİ + HİZMET SARF NORMU (D4-G1a) ─────────────────────────
// Damgalı sürüm, "şu andan itibaren"; yaratma/değişim `clientToken` taşır (replay tek boğaz, servis).

const clientTokenField = z.string().uuid("Geçersiz istemci anahtarı (clientToken)");
const revokeBody = z.object({ reason: z.string().trim().max(300, "Gerekçe en çok 300 karakter").nullable().optional() }).strict();
const machineRateValues = {
  hourRateTry: decimalInput,
  normMPerHour: decimalInput.nullable().optional(),
  note: z.string().nullable().optional(),
  clientToken: clientTokenField,
};
const machineRateCreateSchema = z.object({ machineId: z.string().uuid("Geçersiz makine ID"), ...machineRateValues }).strict();
const machineRateChangeSchema = z.object(machineRateValues).strict();
const normValues = { qtyPerM: decimalInput, note: z.string().nullable().optional(), clientToken: clientTokenField };
const normCreateSchema = z.object({
  serviceItemId: z.string().uuid("Geçersiz hizmet kalemi ID"),
  consumableItemId: z.string().uuid("Geçersiz sarf kalemi ID"),
  ...normValues,
}).strict();
const normChangeSchema = z.object(normValues).strict();

function actorOf(req: Request): string {
  const userId = req.user?.userId;
  if (!userId) throw AppError.unauthorized("Oturum bulunamadı.");
  return userId;
}

/** `filter[<ad>]` id süzgeci (CSV) — her değer UUID olmalı; çıplak ad 400. */
function readUuidFilter(req: Request, name: string): string | { in: string[] } | null {
  const raw = parseQueryParams(req).filters[name];
  const bad = readFilterList(raw).filter((v) => !z.string().uuid().safeParse(v).success);
  if (bad.length) throw AppError.badRequest(`Geçersiz ${name} süzgeci: ${bad.join(", ")}`);
  return readIdCondition(raw);
}
const historyQ = (req: Request) => z.object({ includeRevoked: includeRevokedQ }).passthrough().parse(req.query).includeRevoked;

/**
 * @openapi
 * /api/cost/machine-rates:
 *   get:
 *     tags: [Cost]
 *     summary: Makine saat ücretleri (varsayılan yalnız aktif; includeRevoked=1 geçmiş; filter[machineId] CSV)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *   post:
 *     tags: [Cost]
 *     summary: Makineye saat ücreti yaz (aktif ücret varsa 409; aynı clientToken → aynı satır)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Yazıldı ya da replay }
 *       400: { description: Geçersiz değer }
 *       409: { description: Aktif ücret var / pasif makine / token çakışması }
 */
router.get("/machine-rates", requirePermission("cost:read"), wrap(async (req, res) => {
  assertNoBareFilterParams(req, ["machineId"]);
  const data = await listMachineCostRates({ machineId: readUuidFilter(req, "machineId"), includeRevoked: historyQ(req) });
  res.status(200).json({ success: true, data });
}));

/**
 * @openapi
 * /api/cost/machine-options:
 *   get:
 *     tags: [Cost]
 *     summary: Ücret ekranı için aktif makine seçenekleri (yalnız id/kod/ad; cost:read — station:read gerektirmez)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: cost:read yok ya da maliyet modülü kapalı }
 */
router.get("/machine-options", requirePermission("cost:read"), wrap(async (_req, res) => {
  res.status(200).json({ success: true, data: await listMachineCostOptions() });
}));

router.post("/machine-rates", requirePermission("cost:write"), wrap(async (req, res) => {
  const { machineId, ...values } = machineRateCreateSchema.parse(req.body ?? {});
  const r = await createMachineCostRate(machineId, values, actorOf(req));
  res.status(201).json({ success: true, data: { ...r.row, previousId: r.previousId }, message: "Saat ücreti kaydedildi." });
}));

/**
 * @openapi
 * /api/cost/machine-rates/{id}/change:
 *   post:
 *     tags: [Cost]
 *     summary: Saat ücretini değiştir (eski satır damgalanır + yeni satır, tek tx; şu andan itibaren)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Değişti ya da replay }
 *       409: { description: Satır artık aktif değil (COST_RATE_STALE) }
 * /api/cost/machine-rates/{id}/revoke:
 *   post:
 *     tags: [Cost]
 *     summary: Saat ücretini kaldır (satır silinmez, damgalanır)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       409: { description: Zaten kaldırılmış }
 */
router.post("/machine-rates/:id/change", requirePermission("cost:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const r = await changeMachineCostRate(id, machineRateChangeSchema.parse(req.body ?? {}), actorOf(req));
  res.status(200).json({ success: true, data: { ...r.row, previousId: r.previousId }, message: "Saat ücreti değiştirildi." });
}));

router.post("/machine-rates/:id/revoke", requirePermission("cost:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = revokeBody.parse(req.body ?? {});
  res.status(200).json({ success: true, data: await revokeMachineCostRate(id, reason ?? null, actorOf(req)), message: "Saat ücreti kaldırıldı." });
}));

/**
 * @openapi
 * /api/cost/consumable-norms:
 *   get:
 *     tags: [Cost]
 *     summary: Hizmet sarf normları (varsayılan yalnız aktif; includeRevoked=1 geçmiş; filter[serviceItemId] / filter[consumableItemId] CSV)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *   post:
 *     tags: [Cost]
 *     summary: Hizmet kalemine sarf normu yaz (SERVICE / CONSUMABLE tür kapısı; aynı clientToken → aynı satır)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Yazıldı ya da replay }
 *       400: { description: Tür dışı kalem / geçersiz değer }
 *       409: { description: Aktif norm var / pasif kalem / token çakışması }
 */
router.get("/consumable-norms", requirePermission("cost:read"), wrap(async (req, res) => {
  assertNoBareFilterParams(req, ["serviceItemId", "consumableItemId"]);
  const data = await listConsumableNorms({
    serviceItemId: readUuidFilter(req, "serviceItemId"),
    consumableItemId: readUuidFilter(req, "consumableItemId"),
    includeRevoked: historyQ(req),
  });
  res.status(200).json({ success: true, data });
}));

router.post("/consumable-norms", requirePermission("cost:write"), wrap(async (req, res) => {
  const { serviceItemId, consumableItemId, ...values } = normCreateSchema.parse(req.body ?? {});
  const r = await createConsumableNorm(serviceItemId, consumableItemId, values, actorOf(req));
  res.status(201).json({ success: true, data: { ...r.row, previousId: r.previousId }, message: "Sarf normu kaydedildi." });
}));

/**
 * @openapi
 * /api/cost/consumable-norms/{id}/change:
 *   post:
 *     tags: [Cost]
 *     summary: Sarf normunu değiştir (eski satır damgalanır + yeni satır, tek tx; şu andan itibaren)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Değişti ya da replay }
 *       409: { description: Satır artık aktif değil (CONSUMABLE_NORM_STALE) }
 * /api/cost/consumable-norms/{id}/revoke:
 *   post:
 *     tags: [Cost]
 *     summary: Sarf normunu kaldır (satır silinmez, damgalanır)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       409: { description: Zaten kaldırılmış }
 */
router.post("/consumable-norms/:id/change", requirePermission("cost:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const r = await changeConsumableNorm(id, normChangeSchema.parse(req.body ?? {}), actorOf(req));
  res.status(200).json({ success: true, data: { ...r.row, previousId: r.previousId }, message: "Sarf normu değiştirildi." });
}));

router.post("/consumable-norms/:id/revoke", requirePermission("cost:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = revokeBody.parse(req.body ?? {});
  res.status(200).json({ success: true, data: await revokeConsumableNorm(id, reason ?? null, actorOf(req)), message: "Sarf normu kaldırıldı." });
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
 *     summary: Kumaşın maliyet yapısını yaz (tam küme; boş alan = parametre varsayılanı; processes verilmezse ek işlemlere dokunulmaz)
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

// ── MALİYET HESABI + STANDART MALİYET SÜRÜMÜ (MAL-2) ─────────────────────────
// İstemci hesap yapmaz: önizleme sunucuda (yazmaz). Sürüm donmuş fotoğraftır; geri alma yeni sürümdür.

const versionIdParam = itemIdParam.extend({ versionId: z.string().uuid("Geçersiz sürüm ID") });
const yarnBody = z
  .object({ name: z.string().max(100).optional(), denier: decimalInput.optional(), pricePerKg: decimalInput.optional(), currency: currencyEnum.optional(), picksInRepeat: decimalInput.optional() })
  .strict();
const previewBody = z
  .object({
    itemId: z.string().uuid("Geçersiz ürün ID").optional(),
    // SY-E1: varyant (iş emri şablonu) — tarife kodu varyanttaysa ürün yapısınınkini ezer.
    recipeId: z.string().uuid("Geçersiz varyant ID").optional(),
    adHoc: z
      .object({
        warp: z.object({ endsCount: decimalInput, takeUpPct: decimalInput.optional(), yarn: yarnBody }).strict().nullable().optional(),
        weft: z.object({ picksPerCm: decimalInput, rawWidthCm: decimalInput.optional(), yarns: z.array(yarnBody).min(1).max(8) }).strict().nullable().optional(),
        finishingRateCode: z.string().max(32).nullable().optional(),
      })
      .strict()
      .optional(),
    overrides: body.optional(),
    fxRates: z.partialRecord(currencyEnum, decimalInput).optional(),
    pricing: z
      .object({ currency: currencyEnum, markupPct: decimalInput.optional(), fxRate: decimalInput.optional(), freightPerM: decimalInput.optional(), financeChargePct: decimalInput.optional(), commissionPct: decimalInput.optional() })
      .strict()
      .optional(),
  })
  .strict();
const versionBody = z.object({ reason: z.string().trim().max(300).optional(), fxRates: z.partialRecord(currencyEnum, decimalInput).optional() }).strict();
const restoreBody = z.object({ reason: z.string().trim().max(300).optional() }).strict();
const STRUCTURE_STATUSES = ["YAPI_EKSIK", "VARSAYILAN", "TAM"] as const;

/**
 * `filter[durum]` (CSV) → yapı durumları. Express "simple" ayrıştırıcısı anahtarı DÜZ bırakır (`req.query.filter`
 * hep boştur) → süzgeç sessizce düşerdi; çıplak `durum=` de 400 (fail-closed). Bekçi: test_standart_maliyet_surum.
 */
export function readCostItemStatuses(req: Request): StructureStatus[] {
  assertNoBareFilterParams(req, ["durum"]);
  const statuses = readFilterList(parseQueryParams(req).filters.durum);
  const bad = statuses.filter((d) => !(STRUCTURE_STATUSES as readonly string[]).includes(d));
  if (bad.length) throw AppError.badRequest(`Geçersiz yapı durumu: ${bad.join(", ")}`);
  return statuses as StructureStatus[];
}
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  surum: z.enum(["VAR", "YOK"], { message: "surum yalnız VAR/YOK olabilir" }).optional(),
  girdiDegisti: includeRevokedQ,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * @openapi
 * /api/cost/preview:
 *   post:
 *     tags: [Cost]
 *     summary: Maliyet önizlemesi (YAZMAZ) — ürün ya da elle yapı + ezmeler + kur
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{sonuc, eksikler, uyarilar, girdi, kurlar, teklifFiyati (gövdede pricing varsa: doviz, karYuzde, kur, oneriBirimFiyat, eksik), oneriler:{fx, yarnPrices, warpWaste}}" }
 *       400: { description: Gövde geçersiz / ürün KUMAŞ değil }
 */
router.post("/preview", requirePermission("cost:read"), wrap(async (req, res) => {
  const data = await previewCost(previewBody.parse(req.body ?? {}));
  res.status(200).json({ success: true, data });
}));

/**
 * @openapi
 * /api/cost/quote-currency:
 *   get:
 *     tags: [Cost]
 *     summary: Yeni teklif para birimi ön seçimi (SY-J1) — müşterinin yayındaki fiyat listesi > maliyet sunum dövizi; ayar TRY iken TRY
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: customerId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{doviz, kaynak: VARSAYILAN|FIYAT_LISTESI|AYAR, fiyatListesiNo}" }
 *       400: { description: Geçersiz müşteri ID }
 */
router.get("/quote-currency", requirePermission("quote:write"), wrap(async (req, res) => {
  const { customerId } = z.object({ customerId: z.string().uuid("Geçersiz müşteri ID") }).parse(req.query);
  res.status(200).json({ success: true, data: await suggestQuoteCurrency(customerId) });
}));

/**
 * @openapi
 * /api/cost/items:
 *   get:
 *     tags: [Cost]
 *     summary: Kumaş maliyet listesi — yapı durumu, aktif sürüm, "girdi değişti" (sunucuda süzme + cursor)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: "filter[durum]", schema: { type: string }, description: "YAPI_EKSIK,VARSAYILAN,TAM (CSV)" }
 *       - { in: query, name: surum, schema: { type: string, enum: [VAR, YOK] } }
 *       - { in: query, name: girdiDegisti, schema: { type: string } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: "{data, ozet, toplamSuzulen, nextCursor}" }
 */
router.get("/items", requirePermission("cost:read"), wrap(async (req, res) => {
  const q = listQuery.parse(req.query);
  const statuses = readCostItemStatuses(req);
  const raw = req.query.girdiDegisti;
  const out = await listCostItems({ ...q, durum: statuses, girdiDegisti: raw === undefined ? undefined : q.girdiDegisti });
  res.status(200).json({ success: true, ...out });
}));

/**
 * @openapi
 * /api/cost/subcontractor-dispatches/{id}/finishing-check:
 *   get:
 *     tags: [Cost]
 *     summary: Fason sevk kg kontrolü — beklenen boyahane tutarı (Σ sevk kg × aktif KG tarifesi), fatura varsa fark
 *     description: Yalnız okuma (SY-E2). KG tarifesi çözülemezse `line` null + `reason` (0 tutar uydurulmaz).
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ line, reason }" }
 *       404: { description: Sevk yok }
 */
router.get("/subcontractor-dispatches/:id/finishing-check", requirePermission("cost:read"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await getDispatchFinishingCheck(id) });
}));

/**
 * @openapi
 * /api/cost/items/{itemId}:
 *   get:
 *     tags: [Cost]
 *     summary: Kumaşın maliyet yapısı, kaynaklı canlı girdisi ve aktif sürümün saklanan dökümü
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: itemId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Detay }
 *       404: { description: Ürün yok }
 */
router.get("/items/:itemId", requirePermission("cost:read"), wrap(async (req, res) => {
  const { itemId } = itemIdParam.parse(req.params);
  res.status(200).json({ success: true, data: await getCostItem(itemId) });
}));

/**
 * @openapi
 * /api/cost/items/{itemId}/versions:
 *   get:
 *     tags: [Cost]
 *     summary: Standart maliyet sürüm geçmişi (yeniden eskiye)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: itemId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Sürümler }
 */
router.get("/items/:itemId/versions", requirePermission("cost:read"), wrap(async (req, res) => {
  const { itemId } = itemIdParam.parse(req.params);
  res.status(200).json({ success: true, data: await listStandardCostVersions(itemId) });
}));

/**
 * @openapi
 * /api/cost/items/{itemId}/versions/{versionId}:
 *   get:
 *     tags: [Cost]
 *     summary: Tek standart maliyet sürümü (satır dökümüyle; saklanan değer, yeniden hesap yok)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: versionId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Sürüm + satirlar }
 *       404: { description: Sürüm bulunamadı }
 */
router.get("/items/:itemId/versions/:versionId", requirePermission("cost:read"), wrap(async (req, res) => {
  const { itemId, versionId } = versionIdParam.parse(req.params);
  res.status(200).json({ success: true, data: await getStandardCostVersion(itemId, versionId) });
}));

/**
 * @openapi
 * /api/cost/items/{itemId}/versions:
 *   post:
 *     tags: [Cost]
 *     summary: Standart maliyet sürümü kaydet (önceki ACTIVE → SUPERSEDED, tek tx)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: itemId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       201: { description: Yeni ACTIVE sürüm }
 *       400: { description: "COST_INPUT_MISSING (details.missing[]; kur yoksa FX_RATE_MISSING — 1'e düşmez)" }
 *       409: { description: COST_VERSION_CONFLICT (eşzamanlı kayıt) }
 */
router.post("/items/:itemId/versions", requirePermission("cost:write"), wrap(async (req, res) => {
  const { itemId } = itemIdParam.parse(req.params);
  const data = await createStandardCostVersion(itemId, versionBody.parse(req.body ?? {}), req.user?.userId);
  res.status(201).json({ success: true, data, message: "Standart maliyet kaydedildi." });
}));

/**
 * @openapi
 * /api/cost/items/{itemId}/versions/{versionId}/restore:
 *   post:
 *     tags: [Cost]
 *     summary: Eski sürümün donmuş girdisiyle YENİ sürüm yaz (eskisi değişmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: itemId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: versionId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Yeni ACTIVE sürüm }
 *       404: { description: Sürüm yok }
 *       409: { description: COST_VERSION_CONFLICT }
 */
router.post("/items/:itemId/versions/:versionId/restore", requirePermission("cost:write"), wrap(async (req, res) => {
  const { itemId, versionId } = versionIdParam.parse(req.params);
  const data = await restoreStandardCostVersion(itemId, versionId, restoreBody.parse(req.body ?? {}), req.user?.userId);
  res.status(201).json({ success: true, data, message: "Sürüm geri alındı (yeni sürüm yazıldı)." });
}));

export default router;
