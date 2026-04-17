// =============================================================================
// TeksERP - Order Routes (OrderService + BaseController CRUD)
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { OrderService } from "../services/order.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const service = new OrderService({
  modelName: "order",
  tableName: "ORDER",
  searchFields: ["orderNumber"],
  defaultInclude: {
    customer: true,
    lines: {
      include: { item: true, variant: true },
    },
  },
  nestedCreateFields: ["lines"],
});

const controller = new BaseController(service);
const router = Router();

/**
 * @openapi
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: Sipariş listesi
 *     description: Tüm siparişleri müşteri ve sipariş kalemleri ile listeler.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Sipariş numarası ile arama
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [PENDING, APPROVED, IN_PRODUCTION, PARTIAL_SHIPPED, COMPLETED, CANCELLED] }
 *       - in: query
 *         name: filter[customerId]
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sayfalanmış sipariş listesi
 */
router.get("/", verifyToken, requirePermission("order:read"), controller.findAll);

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Sipariş detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sipariş detayı (müşteri ve kalemler dahil)
 *       404:
 *         description: Sipariş bulunamadı
 */
router.get("/:id", verifyToken, requirePermission("order:read"), controller.findById);

/**
 * @openapi
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Yeni sipariş oluştur
 *     description: Sipariş numarası otomatik üretilir (YYYYMMDD-N formatında).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               currency: { type: string, default: "TRY" }
 *               deadline: { type: string, format: date-time }
 *               lines:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     itemId: { type: string, format: uuid }
 *                     quantity: { type: number }
 *                     unitPrice: { type: number }
 *     responses:
 *       201:
 *         description: Sipariş oluşturuldu
 */
router.post("/", verifyToken, requirePermission("order:write"), controller.create);

/**
 * @openapi
 * /api/orders/{id}:
 *   patch:
 *     tags: [Orders]
 *     summary: Sipariş güncelle
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Güncellendi
 */
router.patch("/:id", verifyToken, requirePermission("order:write"), controller.update);

/**
 * @openapi
 * /api/orders/{id}:
 *   delete:
 *     tags: [Orders]
 *     summary: Sipariş iptal et (soft delete)
 *     description: Siparişin durumunu CANCELLED olarak günceller.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İptal edildi
 */
router.delete("/:id", verifyToken, requirePermission("order:write"), controller.remove);

/**
 * @openapi
 * /api/orders/{id}/permanent:
 *   delete:
 *     tags: [Orders]
 *     summary: Siparişi kalıcı olarak sil
 *     description: Sipariş ve tüm kalemleri veritabanından kalıcı olarak silinir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Kalıcı olarak silindi
 *       404:
 *         description: Sipariş bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("order:write"), controller.hardRemove);

export default router;
