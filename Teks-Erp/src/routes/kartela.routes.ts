// =============================================================================
// TeksERP - Kartela (Swatch) Fason Routes
// =============================================================================
// Bitmiş top → kartela firmasına sevk & dönüş. İŞ EMRİSİZ. Bkz. KARTELA-TASARIM.md.

import { Router } from "express";
import { KartelaController } from "../controllers/kartela.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new KartelaController();
const router = Router();

// ---------------------------------------------------------------------------
// SEVK (Dispatch)
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/kartela/dispatch:
 *   post:
 *     tags: [Kartela]
 *     summary: Depodaki bitmiş topları kartela firmasına sevk
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subcontractorId, rollIds]
 *             properties:
 *               subcontractorId: { type: string, format: uuid }
 *               rollIds:         { type: array, items: { type: string, format: uuid } }
 *               plateNumber:     { type: string }
 *               driverName:      { type: string }
 *               notes:           { type: string }
 *     responses:
 *       201: { description: Kartela sevki oluşturuldu }
 */
router.post(
  "/dispatch",
  verifyToken,
  requireAnyPermission("kartela:write", "mobile:kartela-sevk"),
  controller.dispatch
);

/**
 * @openapi
 * /api/kartela/dispatches/{id}/cancel:
 *   post:
 *     tags: [Kartela]
 *     summary: Kartela sevkini iptal et (soft) — toplar depoya döner
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sevk iptal edildi }
 */
router.post(
  "/dispatches/:id/cancel",
  verifyToken,
  requireAnyPermission("kartela:write", "mobile:kartela-sevk"),
  controller.cancelDispatch
);

/**
 * @openapi
 * /api/kartela/dispatches:
 *   get:
 *     tags: [Kartela]
 *     summary: Kartela sevk listesi
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/dispatches",
  verifyToken,
  requireAnyPermission("kartela:read", "mobile:kartela-sevk", "mobile:kartela-kabul"),
  controller.listDispatches
);

/**
 * @openapi
 * /api/kartela/dispatches/{id}:
 *   get:
 *     tags: [Kartela]
 *     summary: Kartela sevk detayı (çeki listesi)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/dispatches/:id",
  verifyToken,
  requireAnyPermission("kartela:read", "mobile:kartela-sevk", "mobile:kartela-kabul"),
  controller.getDispatch
);

// ---------------------------------------------------------------------------
// KABUL (Receive)
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/kartela/outstanding:
 *   get:
 *     tags: [Kartela]
 *     summary: Kabul worklist'i — firmadaki AT_KARTELA toplar
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/outstanding",
  verifyToken,
  requireAnyPermission("kartela:read", "mobile:kartela-kabul"),
  controller.outstandingRolls
);

/**
 * @openapi
 * /api/kartela/stock:
 *   get:
 *     tags: [Kartela]
 *     summary: Kartela stoğu — müsait kartelaların ürün+renk bazında sayımı (sevk picker)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/stock",
  verifyToken,
  // Sevkiyatçının kartela izni olmayabilir → shipping + mobil paket izinleri de stok listesini görebilir.
  requireAnyPermission(
    "kartela:read",
    "shipping:read",
    "shipping:write",
    "mobile:tarti-paket",
    "mobile:sevkiyat"
  ),
  controller.getStock
);

/**
 * @openapi
 * /api/kartela/receive:
 *   post:
 *     tags: [Kartela]
 *     summary: Kartela mal kabul — top tükenir, N kartela doğar
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subcontractorId, returns]
 *             properties:
 *               subcontractorId: { type: string, format: uuid }
 *               dispatchId:      { type: string, format: uuid }
 *               manifestNo:      { type: string }
 *               notes:           { type: string }
 *               returns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [rollId, count]
 *                   properties:
 *                     rollId:       { type: string, format: uuid }
 *                     count:        { type: integer }
 *                     bulkLengthCm: { type: number }
 *                     bulkWeightKg: { type: number }
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           lengthCm: { type: number }
 *                           weightKg: { type: number }
 *     responses:
 *       201: { description: Kartela kabulü yapıldı }
 */
router.post(
  "/receive",
  verifyToken,
  requireAnyPermission("kartela:write", "mobile:kartela-kabul"),
  controller.receive
);

/**
 * @openapi
 * /api/kartela/receipts:
 *   get:
 *     tags: [Kartela]
 *     summary: Kartela kabul listesi
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/receipts",
  verifyToken,
  requireAnyPermission("kartela:read", "mobile:kartela-sevk", "mobile:kartela-kabul"),
  controller.listReceipts
);

/**
 * @openapi
 * /api/kartela/receipts/{id}:
 *   get:
 *     tags: [Kartela]
 *     summary: Kartela kabul detayı (tüketilen toplar + doğan kartelalar)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/receipts/:id",
  verifyToken,
  requireAnyPermission("kartela:read", "mobile:kartela-sevk", "mobile:kartela-kabul"),
  controller.getReceipt
);

/**
 * @openapi
 * /api/kartela/receipts/{id}/cancel-preview:
 *   get:
 *     tags: [Kartela]
 *     summary: Kabul iptal önizleme — doğan kartelaların downstream bağ kontrolü
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/receipts/:id/cancel-preview",
  verifyToken,
  requireAnyPermission("kartela:write", "mobile:kartela-kabul"),
  controller.getReceiptCancelPreview
);

/**
 * @openapi
 * /api/kartela/receipts/{id}/cancel:
 *   post:
 *     tags: [Kartela]
 *     summary: Kartela kabulünü iptal et (soft) — kartelalar geri alınır
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/receipts/:id/cancel",
  verifyToken,
  requireAnyPermission("kartela:write", "mobile:kartela-kabul"),
  controller.cancelReceipt
);

// ---------------------------------------------------------------------------
// KARTELALIK işareti
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/kartela/rolls/{id}/mark:
 *   post:
 *     tags: [Kartela]
 *     summary: Topu kartelalık işaretle / işareti kaldır
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/rolls/:id/mark",
  verifyToken,
  requireAnyPermission("kartela:write", "mobile:kartela-sevk", "mobile:tambur"),
  controller.setRollMarked
);

export default router;
