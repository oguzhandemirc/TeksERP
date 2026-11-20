// =============================================================================
// TeksERP — Çözgü Kartı (WarpSpec) Routes · devere modülü
// =============================================================================
// Çözgü kartı ana veridir; CRUD `BaseController` üzerinden koşar.
//
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDevereEnabled` (modül rejimi — YALNIZ
// devere; iplik/ticaret bağımlılığı YOK, §9.7d / 1e K3 2026-09-14) → `requirePermission`
// (kişi bunu yapabilir mi). Modül kapısı izin kapısının YERİNE GEÇMEZ: bayrak
// "bu kurulum bu modülü kullanıyor mu", izin "bu kişi bunu yapabilir mi".
// Jenerik `requireModule("devere")` YASAK — kapı varlığı middleware'in ADIYLA
// ölçülüyor (`test_devere_regime_gate`, `test_screen_catalog §10`).
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { WarpSpecService } from "../services/warp-spec.service";
import { WARP_SPEC_YARN_DENIER_INCLUDE } from "../services/helpers/warp-spec-yarn.helper";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled } from "../middlewares/module.middleware";
import { z } from "zod";
import { applyDenierSuggestion, getDenierDeviationReport } from "../services/denier-deviation.service";
import { denierDeviationQuerySchema } from "./reports/dokuma.report.routes";
import "../types/express-augment";

export const warpSpecService = new WarpSpecService({
  modelName: "warpSpec",
  tableName: "WARP_SPEC",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  // Liste ekranı "hangi iplikten" sorusunu kod/ad olmadan cevaplayamaz.
  // Fason devere D2: çok iplikli kartın satırları da (`yarns`, denyeli) — tek okuyucu ailesinin include'u.
  defaultInclude: WARP_SPEC_YARN_DENIER_INCLUDE,
  uniqueField: "code",
  // Kod ELLE girilir (desen kodu saha dilidir: "UA6007-Ç"); autoCode YOK.
  duplicateNameField: "name",
});

const controller = new BaseController(warpSpecService);
const router = Router();

router.use(verifyToken, requireDevereEnabled);

/**
 * @openapi
 * /api/warp-specs:
 *   get:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı listesi (devere modülü)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Devere modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("warpspec:read"), controller.findAll);

/**
 * @openapi
 * /api/warp-specs/similar-names:
 *   get:
 *     tags: [WarpSpecs]
 *     summary: Benzer ad uyarısı (mükerrer kart açmadan önce)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Benzer adlar }
 */
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar, `assertValidUuid` 400 verir ve panelde geliştirici jargonlu bir toast
// çıkar (uyarı ise hiç çizilmez). On üç ana veri router'ında emsali var.
router.get("/similar-names", requirePermission("warpspec:write"), controller.similarNames);

// ── Devere F1: denye sapma raporu + [Uygula] (`/:id`den ÖNCE) ──────────────────
// Sorgu şeması tek tanım: rapor ucu (`/api/reports/dokuma/denye-sapma`, F2) ile aynı.
export { denierDeviationQuerySchema };
const DenierValue = z.union([z.string().trim().min(1, "Denye boş olamaz").max(32), z.number()]).transform((v) => String(v));
export const denierApplyBodySchema = z.object({
  yarnItemId: z.string().uuid("Geçersiz iplik"),
  expectedDenier: DenierValue.nullable(),
  newDenier: DenierValue,
}).strict();

/**
 * @openapi
 * /api/warp-specs/denier-deviation:
 *   get:
 *     tags: [WarpSpecs]
 *     summary: "Denye sapma raporu — kabul edilmiş, tartılı (brüt+dara) devere sarımlarından iplik başına nominal ↔ tartı farkı; tek iplikli sarım iplik satırına, çok iplikli tek karma satırına; öneri örnek ≥ devere.denierSuggestMinBeams ve kart sapması > devere.denierSuggestThresholdPct"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date }, description: "Kabulün fabrika günü (verilmezse bitişten 90 gün önce)" }
 *       - { in: query, name: to, schema: { type: string, format: date }, description: "Verilmezse bugün; aralık en çok 366 gün" }
 *       - { in: query, name: yarnItemId, schema: { type: string, format: uuid } }
 *       - { in: query, name: subcontractorId, schema: { type: string, format: uuid }, description: Devereci }
 *     responses:
 *       200: { description: "data.range · settings · rows[] (status SUGGEST|WITHIN_THRESHOLD|INSUFFICIENT, suggestedDenier, cardDenier) · mixed" }
 *       400: { description: "INVALID_RANGE ya da tanınmayan parametre" }
 *       403: { description: Devere modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/denier-deviation", requirePermission("warpspec:read"), async (req, res, next) => {
  try {
    const q = denierDeviationQuerySchema.parse(req.query);
    res.status(200).json({ success: true, data: await getDenierDeviationReport(q) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-specs/denier-deviation/apply:
 *   post:
 *     tags: [WarpSpecs]
 *     summary: "Denye önerisini iplik kartına uygula (kullanıcı onayı) — atomik; kart arada değiştiyse 409; geçmiş sarım kopyaları değişmez"
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [yarnItemId, expectedDenier, newDenier]
 *             properties:
 *               yarnItemId: { type: string, format: uuid }
 *               expectedDenier: { type: string, nullable: true, description: "Raporun cardDenier değeri" }
 *               newDenier: { type: string, description: "Raporun suggestedDenier değeri" }
 *     responses:
 *       200: { description: "data.oldDenier · newDenier · unchanged (aynı değer zaten yazılı: tekrar deneme)" }
 *       400: { description: "DENIER_INVALID · DENIER_NOT_YARN" }
 *       404: { description: İplik kartı yok }
 *       409: { description: "DENIER_CHANGED (details.currentDenier)" }
 */
router.post("/denier-deviation/apply", requirePermission("item:write"), async (req, res, next) => {
  try {
    const body = denierApplyBodySchema.parse(req.body);
    const data = await applyDenierSuggestion(body, req.user!.userId);
    res.status(200).json({ success: true, data, message: data.unchanged ? "Kart zaten bu denyede" : `İplik kartı denyesi ${data.newDenier} oldu` });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-specs/{id}:
 *   get:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("warpspec:read"), controller.findById);

/**
 * @openapi
 * /api/warp-specs:
 *   post:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı oluştur
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: "Tel adedi ≤ 0 · iplik İPLİK değil · denye boş · aynı iplik iki satır (gövde `yarns: [{ yarnItemId, endsCount }]` satır kümesini REPLACE eder; iplik/tel kolonları satırlardan türer)" }
 */
router.post("/", requirePermission("warpspec:write"), controller.create);

/**
 * @openapi
 * /api/warp-specs/{id}:
 *   patch:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı güncelle (kısmi)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 */
// PATCH (PUT değil): panelin `crudService.update`i PATCH atıyor ve master-data
// CRUD'un tamamı bu fiili kullanıyor (`color.routes.ts` emsali).
router.patch("/:id", requirePermission("warpspec:write"), controller.update);

/**
 * @openapi
 * /api/warp-specs/{id}:
 *   delete:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartını pasife al (soft delete)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", requirePermission("warpspec:write"), controller.remove);

export default router;
