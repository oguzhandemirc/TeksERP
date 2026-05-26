// =============================================================================
// TeksERP - Color (Renk Kataloğu) Routes
// =============================================================================
// Renk kataloğu — fason dönüşünde rulonun yeni Item kimliğine renk verir.
// Item.colorId buradan FK alır; türetilmiş Item.code'unda da kullanılır.
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const service = new BaseService({
  modelName: "color",
  tableName: "COLOR",
  searchFields: ["code", "name"],
  defaultInclude: undefined,
  uniqueField: "code",
});

const controller = new BaseController(service);
const router = Router();

/**
 * @openapi
 * /api/colors:
 *   get:
 *     tags: [Colors]
 *     summary: Renk listesi
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
 *       200: { description: Sayfalanmış renk listesi }
 */
router.get("/", verifyToken, requirePermission("property:read"), controller.findAll);

/**
 * @openapi
 * /api/colors/{id}:
 *   get:
 *     tags: [Colors]
 *     summary: Renk detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Renk detayı }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", verifyToken, requirePermission("property:read"), controller.findById);

/**
 * @openapi
 * /api/colors:
 *   post:
 *     tags: [Colors]
 *     summary: Yeni renk oluştur
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code:      { type: string, example: "MAVI" }
 *               name:      { type: string, example: "Mavi" }
 *               hex:       { type: string, example: "#1d4ed8" }
 *               sortOrder: { type: integer, default: 0 }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       409: { description: Kod zaten mevcut }
 */
router.post("/", verifyToken, requirePermission("property:write"), controller.create);

/**
 * @openapi
 * /api/colors/{id}:
 *   patch:
 *     tags: [Colors]
 *     summary: Rengi güncelle
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
 *               name:      { type: string }
 *               hex:       { type: string }
 *               sortOrder: { type: integer }
 *               isActive:  { type: boolean }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", verifyToken, requirePermission("property:write"), controller.update);

/**
 * @openapi
 * /api/colors/{id}:
 *   delete:
 *     tags: [Colors]
 *     summary: Rengi pasife al
 *     description: Soft-delete. Mevcut Item.colorId referansları korunur (RESTRICT FK yok, SET NULL).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", verifyToken, requirePermission("property:write"), controller.remove);

export default router;
