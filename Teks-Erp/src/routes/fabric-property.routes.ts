// =============================================================================
// TeksERP - FabricProperty (Kumaş Özellik Kataloğu) Routes
// =============================================================================
// Kumaş özellik kataloğu — Yanmazlık, Kayganlık, Su Geçirmezlik vb.
// Türetilmiş Item'a ItemProperty M:N ile bağlanır.
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { BaseService } from "../services/base.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const service = new BaseService({
  modelName: "fabricProperty",
  tableName: "FABRIC_PROPERTY",
  searchFields: ["code", "name", "category", "description"],
  defaultInclude: undefined,
  uniqueField: "code",
});

const controller = new BaseController(service);
const router = Router();

/**
 * @openapi
 * /api/fabric-properties:
 *   get:
 *     tags: [FabricProperties]
 *     summary: Kumaş özellik listesi
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
 *         name: filter[category]
 *         schema: { type: string }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "sortOrder:asc" }
 *     responses:
 *       200: { description: Sayfalanmış özellik listesi }
 */
router.get("/", verifyToken, requirePermission("property:read"), controller.findAll);

/**
 * @openapi
 * /api/fabric-properties/{id}:
 *   get:
 *     tags: [FabricProperties]
 *     summary: Özellik detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Özellik detayı }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", verifyToken, requirePermission("property:read"), controller.findById);

/**
 * @openapi
 * /api/fabric-properties:
 *   post:
 *     tags: [FabricProperties]
 *     summary: Yeni özellik oluştur
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code:        { type: string, example: "YANMAZLIK" }
 *               name:        { type: string, example: "Yanmazlık" }
 *               category:    { type: string, example: "Dayanıklılık" }
 *               description: { type: string }
 *               color:       { type: string, example: "#dc2626" }
 *               sortOrder:   { type: integer, default: 0 }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       409: { description: Kod zaten mevcut }
 */
router.post("/", verifyToken, requirePermission("property:write"), controller.create);

/**
 * @openapi
 * /api/fabric-properties/{id}:
 *   patch:
 *     tags: [FabricProperties]
 *     summary: Özelliği güncelle
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
 *               category:    { type: string }
 *               description: { type: string }
 *               color:       { type: string }
 *               sortOrder:   { type: integer }
 *               isActive:    { type: boolean }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", verifyToken, requirePermission("property:write"), controller.update);

/**
 * @openapi
 * /api/fabric-properties/{id}:
 *   delete:
 *     tags: [FabricProperties]
 *     summary: Özelliği pasife al
 *     description: Soft-delete. Mevcut ItemProperty kayıtları korunur (RESTRICT FK).
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
