// =============================================================================
// TeksERP - Quality Grade (Kalite Derecesi Kataloğu) Routes
// =============================================================================
// Tambur/QC karar ekranlarında operatöre buton olarak çıkar. Admin yönetir;
// Roll.qualityGrade alanı buradan seçilen `code` string'inin snapshot'ıdır.

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";

const MOBILE_QUALITY_READ = ["mobile:kk1", "mobile:kk2-kursun", "mobile:tambur", "mobile:iade"] as const;

// QualityGrade.targetStatus / returnTargetStatus = RollStatus enum; Tambur çıktısı bu
// değeri DOĞRUDAN child Roll.status'a uyguluyor (tambur.service resolveCutStatus). Bare
// BaseController Zod taşımadığından admin herhangi bir RollStatus'u (örn. SHIPPED/DISPATCHED)
// yazabilir → bozuk Tambur çıktısı. Tambur/iade için ANLAMLI alt kümeyle sınırla.
const qgTargetEnum = z.enum(["WAREHOUSE", "A1_STOCK", "STOCK", "SCRAP"]);
const qgReturnEnum = z.enum(["WAREHOUSE", "A1_STOCK", "SCRAP"]);

// UPDATE (PATCH): kısmi — targetStatus opsiyonel.
const qgUpdateSchema = z
  .object({
    targetStatus: qgTargetEnum.optional(),
    returnTargetStatus: qgReturnEnum.nullable().optional(),
  })
  .passthrough();

// F212 — CREATE (POST): targetStatus ZORUNLU. DB default'u SCRAP (yıkıcı); admin
// göndermezse yeni derece SCRAP olur ve Tambur'da sağlam topu fireye yazar.
const qgCreateSchema = z
  .object({
    targetStatus: qgTargetEnum,
    returnTargetStatus: qgReturnEnum.nullable().optional(),
  })
  .passthrough();

function makeQgValidator(schema: z.ZodTypeAny, msg: string) {
  return function (req: Request, _res: Response, next: NextFunction): void {
    if (!schema.safeParse(req.body ?? {}).success) return next(AppError.badRequest(msg));
    next();
  };
}
const validateQgCreate = makeQgValidator(
  qgCreateSchema,
  "Kalite derecesi oluştururken hedef statü (targetStatus) zorunludur: " +
    "WAREHOUSE/A1_STOCK/STOCK/SCRAP. returnTargetStatus yalnız WAREHOUSE/A1_STOCK/SCRAP olabilir.",
);
const validateQgUpdate = makeQgValidator(
  qgUpdateSchema,
  "Geçersiz kalite durumu: targetStatus yalnız WAREHOUSE/A1_STOCK/STOCK/SCRAP, " +
    "returnTargetStatus yalnız WAREHOUSE/A1_STOCK/SCRAP olabilir.",
);

const service = new BaseService({
  modelName: "qualityGrade",
  tableName: "QUALITY_GRADE",
  searchFields: ["code", "name", "description"],
  defaultInclude: undefined,
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "kalite sınıfı",
});

const controller = new BaseController(service);
const router = Router();

/**
 * @openapi
 * /api/quality-grades:
 *   get:
 *     tags: [QualityGrades]
 *     summary: Kalite derecesi listesi
 *     description: Aktif kalite dereceleri Tambur/QC ekranında buton olarak çıkar.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "sortOrder:asc" }
 *     responses:
 *       200: { description: Sayfalanmış kalite derecesi listesi }
 */
// `label-template:read`: Etiket Stüdyosu'nun koşullu basımı ("yalnız 2. kalitede
// yazsın") kaliteleri ADIYLA listeler ama şablona KODU yazar → tasarımcının bu
// katalogu OKUMASI şart, ayrıca `quality:read` verilmesi gerekmesin. Yalnız LİSTE
// ucunda; yazma uçları `quality:write` ile kapalı kalır. Kod LİTERAL yazılır —
// sabite alınırsa `test_permission_catalog` AST tarayıcısı statik çözemez ve
// "BEYANSIZ" diye düşer (mekanik bekçi, 2026-08-02'de tam bunu yakaladı).
router.get("/", verifyToken, requireAnyPermission("quality:read", "label-template:read", ...MOBILE_QUALITY_READ), controller.findAll);

/**
 * @openapi
 * /api/quality-grades/{id}:
 *   get:
 *     tags: [QualityGrades]
 *     summary: Kalite derecesi detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kalite derecesi detayı }
 *       404: { description: Kayıt bulunamadı }
 */
router.get("/:id", verifyToken, requireAnyPermission("quality:read", ...MOBILE_QUALITY_READ), controller.findById);

/**
 * @openapi
 * /api/quality-grades:
 *   post:
 *     tags: [QualityGrades]
 *     summary: Yeni kalite derecesi oluştur
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code:        { type: string, example: "A1" }
 *               name:        { type: string, example: "A1 Kalite" }
 *               description: { type: string }
 *               color:       { type: string, example: "#10b981" }
 *               sortOrder:   { type: integer, default: 0 }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       409: { description: Kod zaten mevcut }
 */
router.post("/", verifyToken, requirePermission("quality:write"), validateQgCreate, controller.create);

/**
 * @openapi
 * /api/quality-grades/{id}:
 *   patch:
 *     tags: [QualityGrades]
 *     summary: Kalite derecesini güncelle
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:        { type: string }
 *               description: { type: string }
 *               color:       { type: string }
 *               sortOrder:   { type: integer }
 *               isActive:    { type: boolean }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", verifyToken, requirePermission("quality:write"), validateQgUpdate, controller.update);

/**
 * @openapi
 * /api/quality-grades/{id}:
 *   delete:
 *     tags: [QualityGrades]
 *     summary: Kalite derecesini pasife al
 *     description: Soft-delete. Mevcut Roll.qualityGrade snapshot'ları korunur.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", verifyToken, requirePermission("quality:write"), controller.remove);

export default router;
