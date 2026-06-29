// =============================================================================
// TeksERP - Device Routes (allowlist + atama)
// =============================================================================
// PUBLIC: POST /api/devices/announce, GET /api/devices/status, /pairing-required
// ADMIN : /api/admin/devices/* (admin:settings)
// =============================================================================

import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { DeviceController } from "../controllers/device.controller";

// PUBLIC (JWT yok)
export const devicePublicRouter = Router();

/**
 * @openapi
 * /api/devices/announce:
 *   post:
 *     tags: [Devices]
 *     summary: Tablet kendini bildirir (PUBLIC — JWT yok)
 *     description: Tablet boot'ta deviceId'sini gönderir. Bilinmiyorsa PENDING açılır (admin onaylar+atar).
 *     responses:
 *       200: { description: Atama durumu (status/machine) }
 */
devicePublicRouter.post("/announce", DeviceController.announce);

/**
 * @openapi
 * /api/devices/status:
 *   get:
 *     tags: [Devices]
 *     summary: Atama durumunu sorgula (PUBLIC — x-device-id header)
 *     responses:
 *       200: { description: "{ status, machineId, machineName, stationName }" }
 */
devicePublicRouter.get("/status", DeviceController.status);

/**
 * @openapi
 * /api/devices/pairing-required:
 *   get:
 *     tags: [Devices]
 *     summary: Cihaz at/onay zorunlu mu (PUBLIC — JWT yok)
 *     description: false (default) ise pasif — tablet onaysız da çalışır (atıf null).
 *     responses:
 *       200: { description: "{ required: boolean }" }
 */
devicePublicRouter.get("/pairing-required", DeviceController.assignmentRequired);

// ADMIN
export const deviceAdminRouter = Router();

/**
 * @openapi
 * /api/admin/devices:
 *   get: { tags: [Admin], summary: Tüm cihazlar (PENDING'ler önce), security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.get("/", verifyToken, requirePermission("admin:settings"), DeviceController.list);

/**
 * @openapi
 * /api/admin/devices/{id}/approve:
 *   post: { tags: [Admin], summary: Cihazı onayla + makineye ata (body machineId?), security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/:id/approve", verifyToken, requirePermission("admin:settings"), DeviceController.approve);

/**
 * @openapi
 * /api/admin/devices/{id}/revoke:
 *   post: { tags: [Admin], summary: Onayı/atamayı geri al (→ PENDING), security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/:id/revoke", verifyToken, requirePermission("admin:settings"), DeviceController.revoke);

/**
 * @openapi
 * /api/admin/devices/{id}:
 *   patch: { tags: [Admin], summary: Cihaz adını güncelle, security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.patch("/:id", verifyToken, requirePermission("admin:settings"), DeviceController.rename);

/**
 * @openapi
 * /api/admin/devices/{id}:
 *   delete: { tags: [Admin], summary: Cihazı pasife al (soft), security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.delete("/:id", verifyToken, requirePermission("admin:settings"), DeviceController.deactivate);

/**
 * @openapi
 * /api/admin/devices/{id}/reactivate:
 *   post: { tags: [Admin], summary: Pasif cihazı tekrar aktifleştir, security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/:id/reactivate", verifyToken, requirePermission("admin:settings"), DeviceController.reactivate);

/**
 * @openapi
 * /api/admin/devices/{id}/permanent:
 *   delete: { tags: [Admin], summary: Kalıcı sil (yalnız atanmamış), security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.delete("/:id/permanent", verifyToken, requirePermission("admin:settings"), DeviceController.hardDelete);
