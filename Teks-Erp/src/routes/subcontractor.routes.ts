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
 *             required: [workOrderId, stepId, subcontractorId, rollIds]
 *             properties:
 *               workOrderId:     { type: string, format: uuid }
 *               stepId:          { type: string, format: uuid }
 *               subcontractorId: { type: string, format: uuid }
 *               rollIds:         { type: array, items: { type: string, format: uuid } }
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
 *             required: [workOrderId, stepId, subcontractorId, manifestNo, returns]
 *             properties:
 *               workOrderId:     { type: string, format: uuid }
 *               stepId:          { type: string, format: uuid }
 *               subcontractorId: { type: string, format: uuid }
 *               manifestNo:      { type: string, description: "Fason firma irsaliye no" }
 *               notes:       { type: string }
 *               returns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [rollId]
 *                   properties:
 *                     rollId: { type: string, format: uuid }
 *                     notes:  { type: string, nullable: true, description: "Bu topa dair kabul notu" }
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

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/print:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason sevk belgesi yazdırma snapshot'ı
 *     description: Sevk fişi belgesi için gerekli tüm verileri döner (toplar, WO, firma, totaller).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Snapshot verisi }
 *       404: { description: Sevk belgesi bulunamadı }
 */
router.get(
  "/dispatches/:id/print",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getDispatchPrint
);

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/cancel:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fason sevkini iptal et (soft cancel)
 *     description: |
 *       Sevk silinmez, cancelledAt/cancelledById/cancelReason set edilir.
 *       Toplar STOCK'a geri döner (currentStepId temizlenir). Mal kabul yapılmış
 *       sevk iptal edilemez.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, minLength: 3, maxLength: 500 }
 *     responses:
 *       200: { description: Sevk iptal edildi }
 *       400: { description: Geçersiz sebep }
 *       404: { description: Sevk bulunamadı }
 *       409: { description: Zaten iptal edilmiş veya mal kabul yapılmış }
 */
router.post(
  "/dispatches/:id/cancel",
  verifyToken,
  requirePermission("workorder:write"),
  controller.cancelDispatch
);

router.get(
  "/receipts",
  verifyToken,
  requirePermission("workorder:read"),
  controller.listReceipts
);

router.get(
  "/receipts/:id/print",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getReceiptPrint
);

router.get(
  "/receipts/:id",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getReceipt
);

export default router;
