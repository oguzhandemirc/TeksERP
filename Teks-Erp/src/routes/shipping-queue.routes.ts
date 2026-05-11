// =============================================================================
// TeksERP - Shipping Queue Routes (sipariş seviyesinde sevkiyat kuyruğu)
// =============================================================================
// Planlamacı (`allocation:write`) siparişi kuyruğa alır ve sıralar; saha
// operatörü (`mobile:tarti-paket`) sıradaki işi alır, çuvalları doldurur,
// tamamlar.
// =============================================================================

import { Router } from "express";
import { ShippingQueueController } from "../controllers/shipping-queue.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new ShippingQueueController();
const router = Router();

/**
 * @openapi
 * /api/shipping-queue:
 *   get:
 *     tags: [ShippingQueue]
 *     summary: Sevkiyat kuyruğu — liste
 *     description: |
 *       Default'ta aktif (WAITING + TAKEN). `status=ALL` ile tüm tarihçe.
 *       `operatorId` ile filtrele.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [WAITING, TAKEN, DONE, CANCELLED, ALL] }
 *       - in: query
 *         name: operatorId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kuyruk listesi }
 */
router.get(
  "/",
  verifyToken,
  requirePermission("shipment:read"),
  controller.list,
);

/**
 * @openapi
 * /api/shipping-queue:
 *   post:
 *     tags: [ShippingQueue]
 *     summary: Siparişi sevkiyat kuyruğuna al
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/",
  verifyToken,
  requirePermission("allocation:write"),
  controller.enqueue,
);

/**
 * @openapi
 * /api/shipping-queue/reorder:
 *   post:
 *     tags: [ShippingQueue]
 *     summary: Kuyruk sırasını güncelle (WAITING, non-urgent)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/reorder",
  verifyToken,
  requirePermission("allocation:write"),
  controller.reorder,
);

/**
 * @openapi
 * /api/shipping-queue/take-next:
 *   post:
 *     tags: [ShippingQueue]
 *     summary: Sıradaki işi al (operatör)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/take-next",
  verifyToken,
  requirePermission("mobile:tarti-paket"),
  controller.takeNext,
);

/**
 * @openapi
 * /api/shipping-queue/{id}/take:
 *   post:
 *     tags: [ShippingQueue]
 *     summary: Belirli işi al
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/:id/take",
  verifyToken,
  requirePermission("mobile:tarti-paket"),
  controller.takeById,
);

/**
 * @openapi
 * /api/shipping-queue/{id}/release:
 *   post:
 *     tags: [ShippingQueue]
 *     summary: Alınan işi geri bırak
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/:id/release",
  verifyToken,
  requirePermission("mobile:tarti-paket"),
  controller.release,
);

/**
 * @openapi
 * /api/shipping-queue/{id}/complete:
 *   post:
 *     tags: [ShippingQueue]
 *     summary: Operatör tamamlandı işaretler
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/:id/complete",
  verifyToken,
  requirePermission("mobile:tarti-paket"),
  controller.complete,
);

/**
 * @openapi
 * /api/shipping-queue/{id}/urgent:
 *   patch:
 *     tags: [ShippingQueue]
 *     summary: Acil işaretle/kaldır
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  "/:id/urgent",
  verifyToken,
  requirePermission("allocation:write"),
  controller.setUrgent,
);

/**
 * @openapi
 * /api/shipping-queue/{id}:
 *   delete:
 *     tags: [ShippingQueue]
 *     summary: Kuyruktan çıkar (CANCELLED)
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  "/:id",
  verifyToken,
  requirePermission("allocation:write"),
  controller.cancel,
);

/**
 * @openapi
 * /api/shipping-queue/{id}/requirements:
 *   get:
 *     tags: [ShippingQueue]
 *     summary: Sipariş gereklilikleri (operatör ihtiyaç ekranı)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/:id/requirements",
  verifyToken,
  requirePermission("shipment:read"),
  controller.getRequirements,
);

export default router;
