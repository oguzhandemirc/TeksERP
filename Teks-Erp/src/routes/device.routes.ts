// =============================================================================
// TeksERP - Device Routes
// =============================================================================
// PUBLIC: POST /api/devices/pair (tablet ilk kurulum, JWT yok)
// ADMIN : /api/admin/devices/* (admin:settings yetkisi)
// =============================================================================

import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { DeviceController } from "../controllers/device.controller";

// PUBLIC pair endpoint
export const devicePublicRouter = Router();
/**
 * @openapi
 * /api/devices/pair:
 *   post:
 *     tags: [Devices]
 *     summary: Tablet pairing (PUBLIC — JWT yok)
 *     description: Tablet ilk açılışta admin tarafından üretilen 6 haneli kodu ve kendi deviceId'sini gönderir.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceId, code]
 *             properties:
 *               deviceId: { type: string, description: Tablet local UUID }
 *               code: { type: string, description: 6 haneli kod }
 *     responses:
 *       200: { description: Eşleşme başarılı — makine bilgisi döner }
 *       400: { description: Kod geçersiz/süresi dolmuş/kullanılmış }
 */
devicePublicRouter.post("/pair", DeviceController.pair);

// ADMIN endpoints
export const deviceAdminRouter = Router();

/**
 * @openapi
 * /api/admin/devices:
 *   get:
 *     tags: [Admin]
 *     summary: Tüm kayıtlı cihazlar (eşleşmeli + eşleşmemiş)
 *     security: [{ bearerAuth: [] }]
 */
deviceAdminRouter.get(
  "/",
  verifyToken,
  requirePermission("admin:settings"),
  DeviceController.list
);

/**
 * @openapi
 * /api/admin/devices/pairing-codes:
 *   post:
 *     tags: [Admin]
 *     summary: Yeni eşleştirme kodu üret
 *     description: 10 dk geçerli 6 haneli kod döner. Tablet kurulum ekranında girilir.
 *     security: [{ bearerAuth: [] }]
 */
deviceAdminRouter.post(
  "/pairing-codes",
  verifyToken,
  requirePermission("admin:settings"),
  DeviceController.createPairingCode
);

/**
 * @openapi
 * /api/admin/devices/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Cihaz adını güncelle
 *     security: [{ bearerAuth: [] }]
 */
deviceAdminRouter.patch(
  "/:id",
  verifyToken,
  requirePermission("admin:settings"),
  DeviceController.rename
);

/**
 * @openapi
 * /api/admin/devices/{id}/unpair:
 *   post:
 *     tags: [Admin]
 *     summary: Eşleşmeyi kaldır (tablet yeniden eşleşme ister)
 *     security: [{ bearerAuth: [] }]
 */
deviceAdminRouter.post(
  "/:id/unpair",
  verifyToken,
  requirePermission("admin:settings"),
  DeviceController.unpair
);

/**
 * @openapi
 * /api/admin/devices/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Cihazı pasife al (soft delete)
 *     security: [{ bearerAuth: [] }]
 */
deviceAdminRouter.delete(
  "/:id",
  verifyToken,
  requirePermission("admin:settings"),
  DeviceController.deactivate
);

/**
 * @openapi
 * /api/admin/devices/{id}/reactivate:
 *   post:
 *     tags: [Admin]
 *     summary: Pasif cihazı tekrar aktifleştir (eşleşme kurulmaz — yeni pairing kodu gerekir)
 *     security: [{ bearerAuth: [] }]
 */
deviceAdminRouter.post(
  "/:id/reactivate",
  verifyToken,
  requirePermission("admin:settings"),
  DeviceController.reactivate
);

/**
 * @openapi
 * /api/admin/devices/{id}/permanent:
 *   delete:
 *     tags: [Admin]
 *     summary: Cihazı kalıcı olarak sil (yalnız eşleşmemiş cihazlar)
 *     security: [{ bearerAuth: [] }]
 */
deviceAdminRouter.delete(
  "/:id/permanent",
  verifyToken,
  requirePermission("admin:settings"),
  DeviceController.hardDelete
);
