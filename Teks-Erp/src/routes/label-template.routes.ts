// =============================================================================
// TeksERP - Label Template Routes
// =============================================================================
// Mount: /api/label-templates
//
// Endpoint'ler:
//   GET    /api/label-templates                         (label-template:read)
//   GET    /api/label-templates/catalog/:kind            (label-template:read)
//   GET    /api/label-templates/:id                      (label-template:read)
//   POST   /api/label-templates                          (label-template:write)
//   PATCH  /api/label-templates/:id                      (label-template:write)
//   POST   /api/label-templates/:id/set-default          (label-template:write)
//   DELETE /api/label-templates/:id                      (label-template:write)
// =============================================================================

import { Router } from "express";
import { LabelTemplateController } from "../controllers/label-template.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new LabelTemplateController();
const router = Router();

/**
 * @openapi
 * /api/label-templates:
 *   get:
 *     tags: [Label Templates]
 *     summary: Etiket template listesi
 *     description: |
 *       LabelKind filtresi opsiyonel. includeInactive=true ise pasif olanlar
 *       da döner. Default önce sıralanır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [ROLL_RAW, ROLL_FINISHED, SWATCH] }
 *       - in: query
 *         name: includeInactive
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: Liste }
 */
router.get("/", verifyToken, requirePermission("label-template:read"), controller.list);

/**
 * @openapi
 * /api/label-templates/catalog/{kind}:
 *   get:
 *     tags: [Label Templates]
 *     summary: Bir LabelKind için izinli alan kataloğu
 *     description: |
 *       Template oluştururken UI'nın gösterdiği "alan havuzu" — hangi key'ler
 *       var, default Türkçe başlıkları, tipleri (text/number/date/qr/barcode/
 *       table), required mı?
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: kind
 *         required: true
 *         schema: { type: string, enum: [ROLL_RAW, ROLL_FINISHED, SWATCH] }
 *     responses:
 *       200: { description: "{ kind, fields: FieldDef[] }" }
 *       400: { description: Geçersiz kind }
 */
router.get("/catalog/:kind", verifyToken, requirePermission("label-template:read"), controller.catalog);

/**
 * @openapi
 * /api/label-templates/preview-raw:
 *   post:
 *     tags: [Label Templates]
 *     summary: Uzman raw-code önizlemesi (sahte veri + verilen kod → ham çıktı)
 *     description: Body { kind, language, code }. {{key}} yer-tutucuları örnek payload'la doldurulur.
 *     security: [{ bearerAuth: [] }]
 */
router.post("/preview-raw", verifyToken, requirePermission("label-template:read"), controller.previewRaw);

/**
 * @openapi
 * /api/label-templates/default-code:
 *   get:
 *     tags: [Label Templates]
 *     summary: Bu tür+dil için otomatik üretilen kod ({{}} yer-tutuculu, düzenlenebilir)
 *     description: ?kind=&language= — "Varsayılan kodu getir" düğmesi bunu editöre yükler.
 *     security: [{ bearerAuth: [] }]
 */
router.get("/default-code", verifyToken, requirePermission("label-template:read"), controller.defaultCode);

/**
 * @openapi
 * /api/label-templates/preview:
 *   post:
 *     tags: [Label Templates]
 *     summary: '"Alanlar" canlı önizlemesi — verilen alanları AKTİF DİLDE render (WYSIWYG)'
 *     description: 'Body { kind, fields, lineStepMm?, qrScale? }. PPLB→svg (birebir), HTML→html, çizilemeyen→text.'
 *     security: [{ bearerAuth: [] }]
 */
router.post("/preview", verifyToken, requirePermission("label-template:read"), controller.fieldsPreview);

/**
 * @openapi
 * /api/label-templates/{id}:
 *   get:
 *     tags: [Label Templates]
 *     summary: Tek template detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 */
router.get("/:id", verifyToken, requirePermission("label-template:read"), controller.findById);

/**
 * @openapi
 * /api/label-templates:
 *   post:
 *     tags: [Label Templates]
 *     summary: Yeni template oluştur
 *     description: |
 *       fields opsiyonel — verilmezse catalog'tan tüm alanlar visible=true
 *       şekilde default olarak üretilir. isDefault=true verilirse aynı kind'taki
 *       diğer default'lar düşürülür (atomic).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, kind]
 *             properties:
 *               name:      { type: string, maxLength: 200 }
 *               kind:      { type: string, enum: [ROLL_RAW, ROLL_FINISHED, SWATCH] }
 *               isDefault: { type: boolean }
 *               isActive:  { type: boolean }
 *               fields:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [key, label, order, isVisible]
 *                   properties:
 *                     key:       { type: string }
 *                     label:     { type: string }
 *                     order:     { type: integer, minimum: 1 }
 *                     isVisible: { type: boolean }
 *                     isBold:    { type: boolean }
 *                     fontSize:  { type: string, enum: [sm, md, lg, xl] }
 */
router.post("/", verifyToken, requirePermission("label-template:write"), controller.create);

/**
 * @openapi
 * /api/label-templates/{id}:
 *   patch:
 *     tags: [Label Templates]
 *     summary: Template güncelle (alan toggle/sırala/bold)
 *     description: |
 *       Operatör (Tambur dahil) `label-template:write` yetkisiyle alan
 *       toggle/sıralama/bold değişikliklerini KALICI olarak yazar. fields
 *       gönderildiyse complete-replace (parça güncelleme yok — tutarlılık).
 *     security: [{ bearerAuth: [] }]
 */
router.patch("/:id", verifyToken, requirePermission("label-template:write"), controller.update);

/**
 * @openapi
 * /api/label-templates/{id}/set-default:
 *   post:
 *     tags: [Label Templates]
 *     summary: Bu template'i kind içinde default yap
 *     description: |
 *       Kind içindeki diğer default'lar atomic olarak düşürülür. Pasif template
 *       default yapılamaz.
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/set-default", verifyToken, requirePermission("label-template:write"), controller.setDefault);

/**
 * @openapi
 * /api/label-templates/{id}:
 *   delete:
 *     tags: [Label Templates]
 *     summary: Template'i pasifleştir (soft delete)
 *     description: |
 *       Default template silinemez — önce başka birini default yapın.
 *     security: [{ bearerAuth: [] }]
 */
router.delete("/:id", verifyToken, requirePermission("label-template:write"), controller.deactivate);

export default router;
