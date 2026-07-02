// =============================================================================
// TeksERP - Label Format Profile Routes
// =============================================================================
// Mount: /api/label-format-profiles
//
// Etiket fiziksel format profilleri (medya boyutu + güvenlik payı). Cihaz kayıtları
// (PeripheralDevice) bunlara REFERANS tutar → yazıcı değişse de tanımlar kalıcı.
// İzin: donanım ailesi `station:read/write` (yeni permission YOK).
// (PrinterModel kataloğu ve /api/printer-models 2026-07'de kaldırıldı.)
// =============================================================================

import { Router } from "express";
import { PrinterLanguage, LabelKind } from "@prisma/client";
import { BaseController } from "../controllers/base.controller";
import { LabelFormatProfileService } from "../services/label-format-profile.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import "../types/express-augment";

// --- Label Format Profile (fiziksel etiket geometrisi + pay) ---
const labelFormatProfileService = new LabelFormatProfileService({
  modelName: "labelFormatProfile",
  tableName: "LABEL_FORMAT_PROFILE",
  searchFields: ["code", "name"],
  uniqueField: "code",
});
const labelFormatProfileController = new BaseController(labelFormatProfileService);

// =============================================================================
// LABEL FORMAT PROFILE ENDPOINTS (/api/label-format-profiles)
// =============================================================================
/**
 * @openapi
 * /api/label-format-profiles:
 *   get: { tags: [Printers], summary: Etiket format profili listesi, security: [{ bearerAuth: [] }], responses: { 200: { description: Liste } } }
 *   post: { tags: [Printers], summary: Etiket format profili oluştur, security: [{ bearerAuth: [] }], responses: { 201: { description: Oluşturuldu } } }
 */
export const labelFormatProfileRouter = Router();
labelFormatProfileRouter.get("/", verifyToken, requirePermission("station:read"), labelFormatProfileController.findAll);
labelFormatProfileRouter.get("/:id", verifyToken, requirePermission("station:read"), labelFormatProfileController.findById);
labelFormatProfileRouter.post("/", verifyToken, requirePermission("station:write"), labelFormatProfileController.create);
labelFormatProfileRouter.patch("/:id", verifyToken, requirePermission("station:write"), labelFormatProfileController.update);
labelFormatProfileRouter.delete("/:id", verifyToken, requirePermission("station:write"), labelFormatProfileController.remove);
labelFormatProfileRouter.delete("/:id/permanent", verifyToken, requirePermission("station:write"), labelFormatProfileController.hardRemove);

/**
 * @openapi
 * /api/label-format-profiles/{id}/set-roll-default:
 *   post: { tags: [Printers], summary: Bu profili TOP etiketi varsayılanı yap (atomik; kartela etkilenmez), security: [{ bearerAuth: [] }], responses: { 200: { description: OK } } }
 */
labelFormatProfileRouter.post(
  "/:id/set-roll-default",
  verifyToken,
  requirePermission("station:write"),
  async (req, res, next) => {
    try {
      const result = await labelFormatProfileService.setRollDefault(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  },
);

/** ?kind = ROLL_RAW (ham) | ROLL_FINISHED (bitmiş) | SWATCH (kartela); default ham. */
const parseKind = (v: unknown): LabelKind =>
  v === "ROLL_FINISHED" || v === "SWATCH" ? (v as LabelKind) : LabelKind.ROLL_RAW;

/**
 * @openapi
 * /api/label-format-profiles/{id}/sample-native:
 *   get: { tags: [Printers], summary: Örnek etiketin native komutu (?kind=ham/bitmiş/kartela; text/plain), security: [{ bearerAuth: [] }], responses: { 200: { description: PPLA/PPLB/ZPL string } } }
 */
labelFormatProfileRouter.get(
  "/:id/sample-native",
  verifyToken,
  requirePermission("station:read"),
  async (req, res, next) => {
    try {
      const raw = typeof req.query.language === "string" ? req.query.language : undefined;
      const language =
        raw === "PPLA" || raw === "PPLB" || raw === "ZPL" ? (raw as PrinterLanguage) : undefined;
      const result = await labelFormatProfileService.getSampleNative(
        req.params.id as string, language, parseKind(req.query.kind),
      );
      res.status(200).type("text/plain; charset=utf-8").send(result.data.content);
    } catch (e) { next(e); }
  },
);

/**
 * @openapi
 * /api/label-format-profiles/{id}/sample-html:
 *   get: { tags: [Printers], summary: Örnek etiket önizleme HTML'i (?kind=ham/bitmiş/kartela), security: [{ bearerAuth: [] }], responses: { 200: { description: HTML } } }
 */
labelFormatProfileRouter.get(
  "/:id/sample-html",
  verifyToken,
  requirePermission("station:read"),
  async (req, res, next) => {
    try {
      const result = await labelFormatProfileService.getSampleHtml(req.params.id as string, parseKind(req.query.kind));
      res.status(200).type("text/html; charset=utf-8").send(result.data.html);
    } catch (e) { next(e); }
  },
);

/**
 * @openapi
 * /api/label-format-profiles/{id}/sample-preview:
 *   get: { tags: [Printers], summary: WYSIWYG önizleme — aktif dilde (PPLB→SVG birebir, diğerleri HTML), security: [{ bearerAuth: [] }], responses: { 200: { description: "{ mode, language, content }" } } }
 */
labelFormatProfileRouter.get(
  "/:id/sample-preview",
  verifyToken,
  requirePermission("station:read"),
  async (req, res, next) => {
    try {
      const result = await labelFormatProfileService.getSamplePreview(req.params.id as string, parseKind(req.query.kind));
      res.status(200).json(result);
    } catch (e) { next(e); }
  },
);
