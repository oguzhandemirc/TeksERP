// =============================================================================
// TeksERP - Subcontractor (Fason) Routes
// =============================================================================

import { Router } from "express";
import { SubcontractorController } from "../controllers/subcontractor.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new SubcontractorController();
const router = Router();

/**
 * @openapi
 * /api/subcontractor/dispatch:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fasona sevk (Dispatch)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workOrderId, stepId, companyId, rollIds]
 *             properties:
 *               workOrderId: { type: string, format: uuid }
 *               stepId:      { type: string, format: uuid }
 *               companyId:   { type: string, format: uuid }
 *               rollIds:     { type: array, items: { type: string, format: uuid } }
 *               plateNumber: { type: string }
 *               driverName:  { type: string }
 *               notes:       { type: string }
 *     responses:
 *       201: { description: Sevk belgesi oluşturuldu }
 */
router.post(
  "/dispatch",
  verifyToken,
  requirePermission("workorder:write"),
  controller.dispatch
);

/**
 * @openapi
 * /api/subcontractor/receive:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fason mal kabul (orijinal rolleri günceller, yeni etiket basmaz)
 *     description: |
 *       Her dispatched roll için dönüşte yeni metraj (+ opsiyonel ağırlık) girilir.
 *       Yeni Roll kaydı oluşturulmaz — orijinal top güncellenir ve sonraki adıma taşınır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workOrderId, stepId, companyId, manifestNo, returns]
 *             properties:
 *               workOrderId: { type: string, format: uuid }
 *               stepId:      { type: string, format: uuid }
 *               companyId:   { type: string, format: uuid }
 *               manifestNo:  { type: string, description: "Fason firma irsaliye no" }
 *               notes:       { type: string }
 *               returns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [rollId, newQty]
 *                   properties:
 *                     rollId:    { type: string, format: uuid }
 *                     newQty:    { type: number, description: "Dönüşte ölçülen net metraj" }
 *                     newWeight: { type: number, nullable: true }
 *                     notes:     { type: string, nullable: true }
 *     responses:
 *       201: { description: Mal kabul oluşturuldu }
 *       400: { description: Validasyon hatası / top bu adımda fason'da değil }
 *       401: { description: Yetkisiz }
 *       404: { description: İş emri/adım bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/receive",
  verifyToken,
  requirePermission("workorder:write"),
  controller.receive
);

/**
 * @openapi
 * /api/subcontractor/pending-returns:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fasonda bekleyen sevkler
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bekleyen sevk gruplari }
 */
router.get(
  "/pending-returns",
  verifyToken,
  requirePermission("workorder:read"),
  controller.pendingReturns
);

router.get(
  "/dispatches",
  verifyToken,
  requirePermission("workorder:read"),
  controller.listDispatches
);

router.get(
  "/dispatches/:id",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getDispatch
);

router.get(
  "/receipts",
  verifyToken,
  requirePermission("workorder:read"),
  controller.listReceipts
);

router.get(
  "/receipts/:id",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getReceipt
);

export default router;
