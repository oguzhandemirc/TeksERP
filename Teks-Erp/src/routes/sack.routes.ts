// =============================================================================
// TeksERP - Sack (Çuval) Routes
// =============================================================================
// Tartı/paket personeli endpoint'leri.

import { Router } from "express";
import { SackController } from "../controllers/sack.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new SackController();
const router = Router();

/**
 * @openapi
 * /api/sacks:
 *   post:
 *     tags: [Sacks]
 *     summary: Yeni çuval aç (bir müşteri için)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Çuval oluşturuldu }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("shipment:write"),
  controller.create
);

/**
 * @openapi
 * /api/sacks/pool:
 *   get:
 *     tags: [Sacks]
 *     summary: Çuvallanmamış toplar+kartelalar (havuz)
 *     description: |
 *       customerId opsiyonel; verilirse müşteri-malı toplar dahil edilir.
 *       Genel havuz çağrısında müşteri-malı toplar gizlenir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Havuz içeriği — rolls + swatches }
 */
router.get(
  "/pool",
  verifyToken,
  requirePermission("shipment:read"),
  controller.getPool
);

/**
 * @openapi
 * /api/sacks/by-customer:
 *   get:
 *     tags: [Sacks]
 *     summary: Müşterinin açık çuvalları (sevkiyatlanmamış)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Açık çuvallar }
 */
router.get(
  "/by-customer",
  verifyToken,
  requirePermission("shipment:read"),
  controller.listByCustomer
);

/**
 * @openapi
 * /api/sacks/open:
 *   get:
 *     tags: [Sacks]
 *     summary: Tüm açık (sevkiyata bağlanmamış) çuvallar — Electron için
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Tüm açık çuvallar, içerikleri ile }
 */
router.get(
  "/open",
  verifyToken,
  requirePermission("shipment:read"),
  controller.listAllOpen
);

/**
 * @openapi
 * /api/sacks/{id}:
 *   get:
 *     tags: [Sacks]
 *     summary: Çuval detayı (içindeki toplar+kartelalar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Çuval içeriği }
 */
router.get(
  "/:id",
  verifyToken,
  requirePermission("shipment:read"),
  controller.getSack
);

/**
 * @openapi
 * /api/sacks/{id}:
 *   delete:
 *     tags: [Sacks]
 *     summary: Çuval sil (sadece boşken)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Silindi }
 *       409: { description: Çuval boş değil veya sevkiyatlanmış }
 */
router.delete(
  "/:id",
  verifyToken,
  requirePermission("shipment:write"),
  controller.remove
);

/**
 * @openapi
 * /api/sacks/update-customer:
 *   patch:
 *     tags: [Sacks]
 *     summary: Çuvalın müşterisini değiştir (sadece boşken)
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  "/update-customer",
  verifyToken,
  requirePermission("shipment:write"),
  controller.updateCustomer
);

/**
 * @openapi
 * /api/sacks/weigh:
 *   post:
 *     tags: [Sacks]
 *     summary: Çuvala brüt ağırlık yaz (opsiyonel — ihracat araç kg kapasitesi)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/weigh",
  verifyToken,
  requirePermission("shipment:write"),
  controller.weigh
);

/**
 * @openapi
 * /api/sacks/assign-roll:
 *   post:
 *     tags: [Sacks]
 *     summary: Topu çuvala ata (opsiyonel sipariş bağı)
 *     description: |
 *       Top çuvala atılır; orderLineId verilirse OrderAllocation güncellenir
 *       (eski allocation'lar temizlenir). Etkilenen siparişlerin statusları
 *       yeniden hesaplanır (READY/SHORT/IN_PRODUCTION).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, sackId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               sackId: { type: string, format: uuid }
 *               orderLineId: { type: string, format: uuid, nullable: true }
 */
router.post(
  "/assign-roll",
  verifyToken,
  requirePermission("shipment:write"),
  controller.assignRoll
);

/**
 * @openapi
 * /api/sacks/remove-roll:
 *   post:
 *     tags: [Sacks]
 *     summary: Topu çuvaldan çıkar (havuza geri)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/remove-roll",
  verifyToken,
  requirePermission("shipment:write"),
  controller.removeRoll
);

/**
 * @openapi
 * /api/sacks/assign-swatch:
 *   post:
 *     tags: [Sacks]
 *     summary: Kartelayı çuvala ata
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/assign-swatch",
  verifyToken,
  requirePermission("shipment:write"),
  controller.assignSwatch
);

/**
 * @openapi
 * /api/sacks/remove-swatch:
 *   post:
 *     tags: [Sacks]
 *     summary: Kartelayı çuvaldan çıkar
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/remove-swatch",
  verifyToken,
  requirePermission("shipment:write"),
  controller.removeSwatch
);

export default router;
