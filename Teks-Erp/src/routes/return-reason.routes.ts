// =============================================================================
// TeksERP - Return Reason (İade Nedeni Kataloğu) Routes
// =============================================================================
// İade ekranında seçenek olarak çıkar (mobil + web). Admin yönetir; RollReturn.reasonId
// buradan seçilen kaydın FK'si (snapshot için reasonText serbest metin de var).
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const service = new BaseService({
  modelName: "returnReason",
  tableName: "RETURN_REASON",
  searchFields: ["code", "name", "description"],
  defaultInclude: undefined,
  uniqueField: "code",
});

const controller = new BaseController(service);
const router = Router();

/**
 * @openapi
 * /api/return-reasons:
 *   get:
 *     tags: [ReturnReasons]
 *     summary: İade nedeni listesi
 *     description: Aktif nedenler İade ekranında seçenek olarak çıkar (mobil + web).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "sortOrder:asc" }
 *     responses:
 *       200: { description: Sayfalanmış neden listesi }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("return:read", "return:write", "mobile:iade"),
  controller.findAll
);

/**
 * @openapi
 * /api/return-reasons/{id}:
 *   get:
 *     tags: [ReturnReasons]
 *     summary: İade nedeni detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Neden detayı }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("return:read", "return:write", "mobile:iade"),
  controller.findById
);

/**
 * @openapi
 * /api/return-reasons:
 *   post:
 *     tags: [ReturnReasons]
 *     summary: Yeni iade nedeni
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code:        { type: string, example: "HASARLI" }
 *               name:        { type: string, example: "Hasarlı" }
 *               description: { type: string }
 *               color:       { type: string, example: "#ef4444" }
 *               sortOrder:   { type: integer, default: 0 }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       409: { description: Kod zaten mevcut }
 */
router.post("/", verifyToken, requirePermission("return:write"), controller.create);

/**
 * @openapi
 * /api/return-reasons/{id}:
 *   patch:
 *     tags: [ReturnReasons]
 *     summary: İade nedenini güncelle
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", verifyToken, requirePermission("return:write"), controller.update);

/**
 * @openapi
 * /api/return-reasons/{id}:
 *   delete:
 *     tags: [ReturnReasons]
 *     summary: İade nedenini pasife al
 *     description: Soft-delete. Mevcut RollReturn.reasonId snapshot'ları korunur.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", verifyToken, requirePermission("return:write"), controller.remove);

export default router;
