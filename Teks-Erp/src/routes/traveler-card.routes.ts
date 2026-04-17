// =============================================================================
// TeksERP - TravelerCard (Refakat Kartı) Routes
// =============================================================================
// İki kök altında servis verir:
//   /api/work-orders/:id/traveler-cards         — WO bazlı print/reprint/history
//   /api/traveler-cards                          — kart bazlı scan/void/lookup
// =============================================================================

import { Router } from "express";
import { TravelerCardController } from "../controllers/traveler-card.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new TravelerCardController();

/** WO-scoped router — /api/work-orders/:id/traveler-cards altında mount edilir */
export const workOrderTravelerRouter = Router({ mergeParams: true });

/**
 * @openapi
 * /api/work-orders/{id}/traveler-cards:
 *   post:
 *     tags: [TravelerCards]
 *     summary: Refakat kartı bas (ilk basım)
 *     description: İş emri için yeni bir ACTIVE refakat kartı üretir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Kart basıldı }
 *       409: { description: Zaten aktif kart var }
 */
workOrderTravelerRouter.post(
  "/",
  verifyToken,
  requirePermission("workorder:write"),
  controller.print
);

/**
 * @openapi
 * /api/work-orders/{id}/traveler-cards/reprint:
 *   post:
 *     tags: [TravelerCards]
 *     summary: Refakat kartı yeniden basım
 *     description: Mevcut ACTIVE kart REPRINTED'a çekilir, yeni bir ACTIVE kart üretilir.
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
 *               reason: { type: string, example: "Kart yırtıldı" }
 *     responses:
 *       201: { description: Yeniden basıldı }
 */
workOrderTravelerRouter.post(
  "/reprint",
  verifyToken,
  requirePermission("workorder:write"),
  controller.reprint
);

/**
 * @openapi
 * /api/work-orders/{id}/traveler-cards/history:
 *   get:
 *     tags: [TravelerCards]
 *     summary: İş emrinin tüm kart + tarama geçmişi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kart ve scan geçmişi }
 */
workOrderTravelerRouter.get(
  "/history",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getHistory
);

/** Kart bazlı router — /api/traveler-cards altında mount edilir */
const travelerCardRouter = Router();

/**
 * @openapi
 * /api/traveler-cards/scan:
 *   post:
 *     tags: [TravelerCards]
 *     summary: İstasyon taraması
 *     description: El terminalinden gelen barkod + istasyon + scanType ile tarama kaydı oluşturur.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode, stationId, scanType]
 *             properties:
 *               barcode:   { type: string, example: "RK-2604-9F2K3P-7" }
 *               stationId: { type: string, format: uuid }
 *               scanType:  { type: string, enum: [ARRIVAL, DEPARTURE, INFO] }
 *               notes:     { type: string }
 *               deviceId:  { type: string }
 *     responses:
 *       201: { description: Tarama kaydedildi }
 *       400: { description: Barkod geçersiz }
 *       404: { description: Kart bulunamadı }
 */
travelerCardRouter.post(
  "/scan",
  verifyToken,
  requirePermission("workorder:write"),
  controller.scan
);

/**
 * @openapi
 * /api/traveler-cards/by-barcode/{barcode}:
 *   get:
 *     tags: [TravelerCards]
 *     summary: Barkoddan kart detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Kart detayı }
 *       404: { description: Kart bulunamadı }
 */
travelerCardRouter.get(
  "/by-barcode/:barcode",
  verifyToken,
  requirePermission("workorder:read"),
  controller.findByBarcode
);

/**
 * @openapi
 * /api/traveler-cards/{id}/void:
 *   post:
 *     tags: [TravelerCards]
 *     summary: Kartı iptal et (VOIDED)
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
 *               reason: { type: string }
 *     responses:
 *       200: { description: Kart iptal edildi }
 */
travelerCardRouter.post(
  "/:id/void",
  verifyToken,
  requirePermission("workorder:write"),
  controller.voidCard
);

export default travelerCardRouter;
