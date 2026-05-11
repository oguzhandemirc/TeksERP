// =============================================================================
// TeksERP - Packaging (Paket/Tartı/Etiket) Routes
// =============================================================================
// Paketleme WO'dan bağımsız fulfillment akışı. Listeleme + take artık
// /api/packaging-queue altında. Bu modül sadece tartı simülasyonu ve finalize.
// =============================================================================

import { Router } from "express";
import { PackagingController } from "../controllers/packaging.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new PackagingController();
const router = Router();

/**
 * @openapi
 * /api/packaging/simulate-weigh/{rollId}:
 *   post:
 *     tags: [Packaging]
 *     summary: Tartı simülasyonu (Faz 1 — COM port yerine rastgele kilo)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rollId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Simüle edilmiş kilo }
 */
router.post(
  "/simulate-weigh/:rollId",
  verifyToken,
  requirePermission("roll:write"),
  controller.simulateWeigh
);

/**
 * @openapi
 * /api/packaging/simulate-weigh-swatch/{swatchId}:
 *   post:
 *     tags: [Packaging]
 *     summary: Kartela tartı simülasyonu (Faz 1, mock değer)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: swatchId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Simüle edilmiş kartela ağırlığı }
 */
router.post(
  "/simulate-weigh-swatch/:swatchId",
  verifyToken,
  requirePermission("roll:write"),
  controller.simulateWeighSwatch
);

/**
 * @openapi
 * /api/packaging/finalize:
 *   post:
 *     tags: [Packaging]
 *     summary: Paketleme finalizasyonu (kilo + etiket)
 *     description: |
 *       Depodaki rulayı tartar, paketler ve READY_FOR_SHIP'e geçirir. Planlama
 *       kuyruğundaki atama varsa orderLineId otomatik çözümlenir; aksi
 *       belirtilmediği sürece allocation yazılır. Etiket payload'u döner.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, weightKg]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               weightKg: { type: number, example: 42.5 }
 *               orderLineId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *     responses:
 *       200: { description: Paketleme tamamlandı, etiket verisi döndü }
 *       400: { description: Validasyon hatası / yanlış durum }
 *       404: { description: Top bulunamadı }
 */
router.post(
  "/finalize",
  verifyToken,
  requirePermission("roll:write"),
  controller.finalize
);

export default router;
