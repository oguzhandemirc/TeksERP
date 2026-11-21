// =============================================================================
// EK MALİYET FORMÜLLERİ + DESEN AİLESİNE ATKI ÜCRETİ ROTALARI (/api/cost) — SY-C1/C3
// =============================================================================
// ⚠️ KAPI TOPLU: `router.use(verifyToken, requireMaliyetEnabled)` (cost.routes ile aynı sözleşme).
// İzinler: okuma `cost:read`; formül yazımı `cost:settings` (tesis geneli hesap kuralı); toplu atkı
// ücreti `cost:write` (ürün yapısı yazımı). Önizlemeler hiçbir şey yazmaz.
// ⚠️ YOL SIRASI: sabit alt yollar (`/formulas/variables`, `/formulas/preview`) `/:id`ten ÖNCE.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireMaliyetEnabled } from "../middlewares/module.middleware";
import { listSearchParam } from "../utils/list-search";
import {
  changeCostFormula,
  createCostFormula,
  listCostFormulaVariables,
  listCostFormulas,
  previewCostFormula,
  revokeCostFormula,
} from "../services/cost-formula.service";
import { applyPickRateFamily, listPickRateFamilies, previewPickRateFamily } from "../services/cost-pick-rate-family.service";

const router = Router();
router.use(verifyToken, requireMaliyetEnabled);

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (h: H) => (req: Request, res: Response, next: NextFunction): void => {
  h(req, res).catch(next);
};

const idParam = z.object({ id: z.string().uuid("Geçersiz kayıt ID") });
const includeRevokedQ = z
  .enum(["0", "1", "true", "false"], { message: "includeRevoked yalnız 0/1/true/false olabilir" })
  .optional()
  .transform((v) => v === "1" || v === "true");
const formulaBody = z.object({
  code: z.string().max(32).optional(),
  name: z.string().max(100),
  expression: z.string().max(500),
  currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"], { message: "Geçersiz para birimi" }).optional(),
  sortOrder: z.union([z.number(), z.string()]).optional(),
  note: z.string().nullable().optional(),
});

/**
 * @openapi
 * /api/cost/formulas:
 *   get:
 *     tags: [Cost]
 *     summary: Ek maliyet formülleri (varsayılan yalnız yürürlükteki; includeRevoked=1 geçmiş sürümler)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *         description: "Metin araması — formül kodu, adı ya da ifadesi; boş = arama yok"
 *     responses:
 *       200: { description: Liste }
 */
router.get("/formulas", requirePermission("cost:read"), wrap(async (req, res) => {
  const q = z.object({ includeRevoked: includeRevokedQ, code: z.string().max(32).optional(), search: listSearchParam }).parse(req.query);
  res.status(200).json({ success: true, data: await listCostFormulas(q) });
}));

/**
 * @openapi
 * /api/cost/formulas/variables:
 *   get:
 *     tags: [Cost]
 *     summary: Formülde kullanılabilen değişkenler (ad, açıklama, birim, örnek değer, bağlı mı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Katalog }
 */
router.get("/formulas/variables", requirePermission("cost:read"), wrap(async (_req, res) => {
  res.status(200).json({ success: true, data: listCostFormulaVariables() });
}));

/**
 * @openapi
 * /api/cost/formulas/preview:
 *   post:
 *     tags: [Cost]
 *     summary: Formülü örnek değerlerle hesapla (hiçbir şey yazmaz; canlı önizleme)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "sonuc ya da hata (sıfıra bölme vb.)" }
 *       400: { description: Ayrıştırılamayan ifade / tanınmayan değişken }
 */
router.post("/formulas/preview", requirePermission("cost:read"), wrap(async (req, res) => {
  const b = z.object({ expression: z.string().max(500), values: z.record(z.string(), z.union([z.string(), z.number()])).optional() }).parse(req.body ?? {});
  res.status(200).json({ success: true, data: previewCostFormula(b) });
}));

/**
 * @openapi
 * /api/cost/formulas:
 *   post:
 *     tags: [Cost]
 *     summary: Yeni ek maliyet formülü (sürüm 1)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Yaratıldı }
 *       400: { description: Geçersiz ifade / tanınmayan değişken }
 *       409: { description: Kod yürürlükte }
 */
router.post("/formulas", requirePermission("cost:settings"), wrap(async (req, res) => {
  const b = formulaBody.parse(req.body ?? {});
  res.status(201).json({ success: true, data: await createCostFormula(b, req.user?.userId), message: "Formül kaydedildi." });
}));

/**
 * @openapi
 * /api/cost/formulas/{id}/change:
 *   post:
 *     tags: [Cost]
 *     summary: Formülü değiştir (eski sürüm damgalanır, yeni sürüm doğar; eski maliyet sürümleri etkilenmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Yazıldı ya da aynı (wrote=false) }
 *       409: { description: Sürüm artık yürürlükte değil }
 */
router.post("/formulas/:id/change", requirePermission("cost:settings"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const b = formulaBody.parse(req.body ?? {});
  const r = await changeCostFormula(id, b, req.user?.userId);
  res.status(200).json({ success: true, data: { ...r.row, wrote: r.wrote }, message: r.wrote ? "Formülün yeni sürümü kaydedildi." : "Formül zaten bu hâlde — değişiklik yapılmadı." });
}));

/**
 * @openapi
 * /api/cost/formulas/{id}/revoke:
 *   post:
 *     tags: [Cost]
 *     summary: Formülü kaldır (satır silinmez, damgalanır)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       409: { description: Zaten kaldırılmış }
 */
router.post("/formulas/:id/revoke", requirePermission("cost:settings"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await revokeCostFormula(id, req.user?.userId), message: "Formül kaldırıldı." });
}));

/**
 * @openapi
 * /api/cost/pick-rate-families:
 *   get:
 *     tags: [Cost]
 *     summary: Desen aileleri (desen kartı aile etiketi) ve kumaş sayıları
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 */
router.get("/pick-rate-families", requirePermission("cost:read"), wrap(async (_req, res) => {
  res.status(200).json({ success: true, data: await listPickRateFamilies() });
}));

/**
 * @openapi
 * /api/cost/pick-rate-families/preview:
 *   get:
 *     tags: [Cost]
 *     summary: Aileye toplu atkı ücreti önizlemesi — etkilenen HER kumaş, mevcut ücret ve kaynağı
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: familyLabel, required: true, schema: { type: string, maxLength: 40 } }]
 *     responses:
 *       200: { description: Önizleme }
 */
router.get("/pick-rate-families/preview", requirePermission("cost:read"), wrap(async (req, res) => {
  const q = z.object({ familyLabel: z.string().max(40) }).parse(req.query);
  res.status(200).json({ success: true, data: await previewPickRateFamily(q.familyLabel) });
}));

/**
 * @openapi
 * /api/cost/pick-rate-families/apply:
 *   post:
 *     tags: [Cost]
 *     summary: Seçilen kumaşların ürün yapısına atkı ücreti yaz (yalnız ailenin kumaşları)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Aile dışı kumaş / boş seçim }
 */
router.post("/pick-rate-families/apply", requirePermission("cost:write"), wrap(async (req, res) => {
  const b = z.object({
    familyLabel: z.string().max(40),
    rate: z.union([z.string(), z.number()]),
    currency: z.enum(["TRY", "USD", "EUR", "GBP", "RUB"], { message: "Geçersiz para birimi" }),
    itemIds: z.array(z.string().uuid("Geçersiz ürün ID")).min(1, "En az bir kumaş seçilmeli").max(500),
  }).parse(req.body ?? {});
  const r = await applyPickRateFamily(b, req.user?.userId);
  res.status(200).json({ success: true, data: r, message: `${r.updated} kumaşın atkı ücreti güncellendi.` });
}));

export default router;
