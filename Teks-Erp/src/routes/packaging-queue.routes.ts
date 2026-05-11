// =============================================================================
// TeksERP - Packaging Queue Routes
// =============================================================================
// Planlamacı (`allocation:write`) kuyruğu yönetir; operatör (`mobile:tarti-paket`)
// sadece sıradaki işi alır.
// =============================================================================

import { Router } from "express";
import { PackagingQueueController } from "../controllers/packaging-queue.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new PackagingQueueController();
const router = Router();

/**
 * @openapi
 * /api/packaging-queue:
 *   get:
 *     tags: [PackagingQueue]
 *     summary: Paketleme kuyruğunu listele
 *     description: |
 *       Default'ta aktif kayıtlar (WAITING + TAKEN). `status=ALL` tarihçe dahil.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [WAITING, TAKEN, DONE, CANCELLED, ALL]
 *     responses:
 *       200: { description: Kuyruk listesi }
 */
router.get(
  "/",
  verifyToken,
  requirePermission("allocation:write"),
  controller.getQueue
);

/**
 * @openapi
 * /api/packaging-queue:
 *   post:
 *     tags: [PackagingQueue]
 *     summary: Depodaki rulayı kuyruğa ekle (planlama)
 *     description: |
 *       Planlamacı bir depodaki ruloyu kuyruğa atar. plannedOrderId boş ise
 *       stoğa paketleme (sonradan atanabilir). SERVICE_PRODUCTION rulları
 *       sadece kendi müşterilerinin siparişine atanabilir.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               plannedOrderId: { type: string, format: uuid, nullable: true }
 *               priority: { type: integer, description: "Belirtilmezse en sona eklenir" }
 *               note: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       201: { description: Eklendi }
 *       400: { description: Rulo WAREHOUSE değil veya sipariş atanamaz }
 *       409: { description: Bu rulo zaten kuyrukta }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("allocation:write"),
  controller.addToQueue
);

/**
 * @openapi
 * /api/packaging-queue/bulk:
 *   post:
 *     tags: [PackagingQueue]
 *     summary: Toplu rulo ekleme (planner UI'dan drag-assign)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [rollId]
 *                   properties:
 *                     rollId: { type: string, format: uuid }
 *                     plannedOrderId: { type: string, format: uuid, nullable: true }
 *                     note: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       201: { description: Toplu eklendi }
 *       409: { description: Bir veya daha fazla rulo zaten aktif kuyrukta }
 */
router.post(
  "/bulk",
  verifyToken,
  requirePermission("allocation:write"),
  controller.bulkAdd
);

/**
 * @openapi
 * /api/packaging-queue/{id}/planned-order:
 *   patch:
 *     tags: [PackagingQueue]
 *     summary: Kuyruktaki rulonun atanmış siparişini değiştir
 *     description: Sadece WAITING için. TAKEN/DONE'da değiştirilemez.
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
 *             required: [plannedOrderId]
 *             properties:
 *               plannedOrderId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Sadece WAITING için }
 */
router.patch(
  "/:id/planned-order",
  verifyToken,
  requirePermission("allocation:write"),
  controller.updatePlannedOrder
);

/**
 * @openapi
 * /api/packaging-queue/reorder:
 *   patch:
 *     tags: [PackagingQueue]
 *     summary: Toplu öncelik güncelle (sürükle-bırak)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, priority]
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     priority: { type: integer }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch(
  "/reorder",
  verifyToken,
  requirePermission("allocation:write"),
  controller.reorder
);

/**
 * @openapi
 * /api/packaging-queue/available:
 *   get:
 *     tags: [PackagingQueue]
 *     summary: Operatör için bekleyen kuyruk listesi (sayfalı)
 *     description: |
 *       Operatör hangi siparişten başlayacağına karar versin diye WAITING
 *       kayıtları öncelik sırasına göre döndürür. Kuyruk hacmi az olur ama
 *       sistem yorulmasın diye sayfalama zorunlu (default 20, max 50).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *     responses:
 *       200: { description: Bekleyen kuyruk listesi }
 */
router.get(
  "/available",
  verifyToken,
  requirePermission("mobile:tarti-paket"),
  controller.getAvailable
);

/**
 * @openapi
 * /api/packaging-queue/take-next:
 *   post:
 *     tags: [PackagingQueue]
 *     summary: Operatör — sıradaki bekleyen işi al (otomatik seçim)
 *     description: |
 *       Kuyruğun en üstündeki WAITING kaydı TAKEN'a çevirir. Yarış için
 *       SKIP LOCKED kullanılır. Kayıt yoksa data=null döner.
 *       Mobil tarafında kullanılmıyor (operatör listeden seçer); legacy/script
 *       senaryoları için tutuluyor.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Alınan iş veya null }
 */
router.post(
  "/take-next",
  verifyToken,
  requirePermission("mobile:tarti-paket"),
  controller.takeNext
);

/**
 * @openapi
 * /api/packaging-queue/{id}/take:
 *   post:
 *     tags: [PackagingQueue]
 *     summary: Operatör — listeden seçilen belirli kaydı al
 *     description: |
 *       FOR UPDATE SKIP LOCKED ile aynı kaydın iki operatöre verilmesi engellenir.
 *       Kayıt başkası tarafından alındıysa veya artık WAITING değilse 409 döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: İş alındı }
 *       409: { description: Bu iş başkası tarafından alındı }
 */
router.post(
  "/:id/take",
  verifyToken,
  requirePermission("mobile:tarti-paket"),
  controller.takeById
);

/**
 * @openapi
 * /api/packaging-queue/{id}/urgent:
 *   patch:
 *     tags: [PackagingQueue]
 *     summary: Acil olarak işaretle / acil işaretini kaldır
 *     description: |
 *       Acil kayıtlar listede tepeye taşınır; aralarında urgentMarkedAt FIFO
 *       sırası uygulanır (ilk işaretlenen üstte). Sadece WAITING/TAKEN için.
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
 *             required: [isUrgent]
 *             properties:
 *               isUrgent: { type: boolean }
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: DONE/CANCELLED kayıt için reddedilir }
 */
router.patch(
  "/:id/urgent",
  verifyToken,
  requirePermission("allocation:write"),
  controller.setUrgent
);

/**
 * @openapi
 * /api/packaging-queue/orders/{orderId}/candidates:
 *   get:
 *     tags: [PackagingQueue]
 *     summary: Bir sipariş için atanabilir depo rulularını listele
 *     description: |
 *       WAREHOUSE statüsündeki, aktif kuyrukta olmayan rulları döner. SERVICE_PRODUCTION
 *       rulları (Roll.ownerCustomerId) sadece sipariş müşterisine eşitse görünür.
 *       `onlyMatching=true` → sipariş satırlarındaki item.id veya baseItem.id ile eşleşenler.
 *       Roll listesi `operations.operationType` (KURSUN_APPLIED), `properties` ve renk içerir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: onlyMatching
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Aday rulo listesi }
 *       404: { description: Sipariş bulunamadı }
 */
router.get(
  "/orders/:orderId/candidates",
  verifyToken,
  requirePermission("allocation:write"),
  controller.getOrderCandidates
);

/**
 * @openapi
 * /api/packaging-queue/orders/{orderId}/assign-rolls:
 *   post:
 *     tags: [PackagingQueue]
 *     summary: Seçilen rulları siparişe ata; kuyruğu termine göre yeniden sırala
 *     description: |
 *       `bulkAdd` paterni — her item plannedOrderId=orderId ile eklenir. Sonunda WAITING
 *       (non-urgent) kayıtları `plannedOrder.deadline ASC NULLS LAST, createdAt` sırasıyla
 *       yeniden önceliklendirilir. Acil (isUrgent) kayıtlar etkilenmez.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderId
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
 *               rollIds:
 *                 type: array
 *                 maxItems: 200
 *                 items: { type: string, format: uuid }
 *               note: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       201: { description: Atandı ve yeniden sıralandı }
 *       400: { description: Sipariş veya rulo atanamaz }
 *       409: { description: Bir veya daha fazla rulo zaten aktif kuyrukta }
 */
router.post(
  "/orders/:orderId/assign-rolls",
  verifyToken,
  requirePermission("allocation:write"),
  controller.assignRollsToOrder
);

/**
 * @openapi
 * /api/packaging-queue/{id}:
 *   delete:
 *     tags: [PackagingQueue]
 *     summary: Kuyruktan çıkar (CANCELLED)
 *     description: Sadece WAITING kayıt iptal edilebilir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cancelReason: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       200: { description: İptal edildi }
 *       400: { description: TAKEN kayıt iptal edilemez }
 *       404: { description: Bulunamadı }
 */
router.delete(
  "/:id",
  verifyToken,
  requirePermission("allocation:write"),
  controller.remove
);

export default router;
