// =============================================================================
// TeksERP - Batch (Parti) Routes — K8 düzeltme araçları
// =============================================================================
// Sevksiz parti düzeltme uçları. Tümü workorder:write gerektirir. Servis katmanı
// (batch.service) türetilmiş kilit + izsiz-boş silme + audit'i yönetir.
// =============================================================================

import { Router } from "express";
import { BatchController } from "../controllers/batch.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new BatchController();
const router = Router();

/**
 * @openapi
 * /api/batches/move-rolls:
 *   post:
 *     tags: [Batches]
 *     summary: Topları başka sevksiz partiye taşı (K8)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds, toBatchId]
 *             properties:
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *               toBatchId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Taşındı }
 *       409: { description: Kaynak/hedef parti sevk edilmiş (kilitli) }
 */
router.post("/move-rolls", verifyToken, requirePermission("workorder:write"), controller.moveRolls);

/**
 * @openapi
 * /api/batches/merge:
 *   post:
 *     tags: [Batches]
 *     summary: Sevksiz partileri birleştir — en eski no yaşar (K8)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [batchIds]
 *             properties:
 *               batchIds: { type: array, items: { type: string, format: uuid }, minItems: 2 }
 *     responses:
 *       200: { description: Birleştirildi }
 *       409: { description: Partilerden biri sevk edilmiş (kilitli) }
 */
router.post("/merge", verifyToken, requirePermission("workorder:write"), controller.mergeBatches);

/**
 * @openapi
 * /api/batches/{batchId}/split:
 *   post:
 *     tags: [Batches]
 *     summary: Partiden seçili topları yeni partiye ayır (K8 elle böl)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: batchId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollIds]
 *             properties:
 *               rollIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Yeni parti oluşturuldu }
 *       409: { description: Kaynak parti sevk edilmiş (kilitli) }
 */
router.post("/:batchId/split", verifyToken, requirePermission("workorder:write"), controller.splitBatch);

export default router;
