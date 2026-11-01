// =============================================================================
// TeksERP - Device Routes (allowlist + atama)
// =============================================================================
// PUBLIC: POST /api/devices/announce, GET /api/devices/status, /pairing-required,
//         POST /api/devices/rebind-requests/onsite-approve (yerinde yönetici onayı)
// ADMIN : /api/admin/devices/* (admin:settings)
// =============================================================================

import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { DeviceController } from "../controllers/device.controller";
import { DeviceProofResetController } from "../controllers/device-proof-reset.controller";
import { DeviceMergeController } from "../controllers/device-merge.controller";

// PUBLIC (JWT yok)
export const devicePublicRouter = Router();

/**
 * @openapi
 * /api/devices/announce:
 *   post:
 *     tags: [Devices]
 *     summary: Tablet kendini bildirir (PUBLIC — JWT yok)
 *     description: |
 *       Tablet boot'ta deviceId'sini gönderir. Bilinmeyen cihazın doğuş durumu
 *       `devicePairingRequired` bayrağına bağlıdır: bayrak AÇIK ise PENDING
 *       (admin onaylar+atar), KAPALI ise APPROVED (onay adımı yok).
 *       Cevap `pairingRequired` alanını DA taşır — onay ekranı kararı sunucudadır.
 *     responses:
 *       200: { description: "{ pairingRequired, status, machineId, machineName, stationName }" }
 */
devicePublicRouter.post("/announce", DeviceController.announce);

/**
 * @openapi
 * /api/devices/status:
 *   get:
 *     tags: [Devices]
 *     summary: Atama durumunu sorgula (PUBLIC — x-device-id header)
 *     description: |
 *       `pairingRequired` cevabın parçasıdır: onay ekranı koşulu
 *       `pairingRequired && status !== "APPROVED"` — istemci iki ucu birleştirip
 *       mantığı kendi kurmaz.
 *     responses:
 *       200: { description: "{ pairingRequired, status, machineId, machineName, stationName }" }
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

/**
 * @openapi
 * /api/devices/rebind-requests/onsite-approve:
 *   post:
 *     tags: [Devices]
 *     summary: Tablette yerinde yönetici onayı — yeniden bağlama talebi (PUBLIC — JWT yok)
 *     description: |
 *       Gövde `{localId, username, password, totp?}`. Kimlik giriş ucunun doğrulayıcısıyla ve
 *       AYNI kilit kovasıyla sınanır; izin `admin:settings`. JWT VERİLMEZ, oturum açılmaz.
 *       Hız sınırı IP + localId. Başarıda talep onaylanır, tablet yeniden announce eder.
 *     responses:
 *       200: { description: "{ id, targetDeviceId, targetName, status: APPROVED }" }
 *       401: { description: Geçersiz kimlik ya da TOTP_INVALID }
 *       403: { description: REBIND_APPROVER_FORBIDDEN ya da PASSWORD_CHANGE_REQUIRED }
 *       404: { description: REBIND_REQUEST_NOT_FOUND }
 *       409: { description: TOTP_REQUIRED ya da REBIND_ALREADY_DECIDED }
 *       429: { description: LOGIN_LOCKED ya da REBIND_RATE_LIMITED }
 */
devicePublicRouter.post("/rebind-requests/onsite-approve", DeviceController.onsiteApproveRebind);

// ADMIN
export const deviceAdminRouter = Router();

/**
 * @openapi
 * /api/admin/devices:
 *   get: { tags: [Admin], summary: Tüm cihazlar (PENDING'ler önce), security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.get("/", verifyToken, requirePermission("admin:settings"), DeviceController.list);

// ⚠️ STATİK yollar `/:id` rotalarından ÖNCE: yoksa "rebind-requests" bir cihaz id'si sanılır.
/**
 * @openapi
 * /api/admin/devices/rebind-requests:
 *   get: { tags: [Admin], summary: "Yeniden bağlama talepleri (açıklar önce)", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.get("/rebind-requests", verifyToken, requirePermission("admin:settings"), DeviceController.listRebindRequests);

/**
 * @openapi
 * /api/admin/devices/rebind-requests/{id}/approve:
 *   post: { tags: [Admin], summary: "Yeniden bağlama talebini onayla — yeni kurulum hedef cihaza bağlanır", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/rebind-requests/:id/approve", verifyToken, requirePermission("admin:settings"), DeviceController.approveRebind);

/**
 * @openapi
 * /api/admin/devices/rebind-requests/{id}/reject:
 *   post: { tags: [Admin], summary: "Yeniden bağlama talebini reddet (body mode REDDET|AYRI_CIHAZ, reason?)", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/rebind-requests/:id/reject", verifyToken, requirePermission("admin:settings"), DeviceController.rejectRebind);

/**
 * @openapi
 * /api/admin/devices/proof-lost:
 *   get: { tags: [Admin], summary: "Kanıtı doğrulanamayan cihazlar (anahtar halkası kaybı) + yeniden bağlanmayı bekleyenler; yazmaz", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.get("/proof-lost", verifyToken, requirePermission("admin:settings"), DeviceProofResetController.proofLost);

/**
 * @openapi
 * /api/admin/devices/proof-reset:
 *   post: { tags: [Admin], summary: "Seçilen cihazlarda kanıtı sıfırla — yeni sır yalnız aynı donanıma (body deviceIds[])", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/proof-reset", verifyToken, requirePermission("admin:settings"), DeviceProofResetController.proofReset);

/**
 * @openapi
 * /api/admin/devices/merge/candidates:
 *   get: { tags: [Admin], summary: "Kopya olabilecek cihaz kayıtları (sezgi grupları; yalnız öneri)", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.get("/merge/candidates", verifyToken, requirePermission("admin:settings"), DeviceMergeController.mergeCandidates);

/**
 * @openapi
 * /api/admin/devices/merge/preview:
 *   post: { tags: [Admin], summary: "Birleştirme önizlemesi (body targetId, sourceIds[]; yan etkisiz)", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/merge/preview", verifyToken, requirePermission("admin:settings"), DeviceMergeController.mergePreview);

/**
 * @openapi
 * /api/admin/devices/merge:
 *   post: { tags: [Admin], summary: "Seçilen cihaz kopyalarını ana kayda birleştir (body targetId, sourceIds[])", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/merge", verifyToken, requirePermission("admin:settings"), DeviceMergeController.merge);

/**
 * @openapi
 * /api/admin/devices/merge/{sourceId}/undo:
 *   post: { tags: [Admin], summary: "Cihaz birleştirmesini geri al (UNMERGED karşı olayı)", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/merge/:sourceId/undo", verifyToken, requirePermission("admin:settings"), DeviceMergeController.undoMerge);

/**
 * @openapi
 * /api/admin/devices/pending/reject:
 *   post:
 *     tags: [Admin]
 *     summary: Seçili bekleyen cihazları toplu reddet (pasife al; satır silinmez)
 *     description: "Body { ids: uuid[] (1–200) }. Yalnız hâlâ bekleyen (PENDING + aktif) satırlar reddedilir; dönüş { rejected: id[] }."
 *     security: [{ bearerAuth: [] }]
 */
deviceAdminRouter.post("/pending/reject", verifyToken, requirePermission("admin:settings"), DeviceController.rejectPending);

/**
 * @openapi
 * /api/admin/devices/{id}:
 *   get: { tags: [Admin], summary: "Cihaz detayı — donanım/etiket profili + son çalışma oturumu", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.get("/:id", verifyToken, requirePermission("admin:settings"), DeviceController.detail);

/**
 * @openapi
 * /api/admin/devices/{id}/approve:
 *   post: { tags: [Admin], summary: Cihazı onayla + makineye ata (body machineId?), security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/:id/approve", verifyToken, requirePermission("admin:settings"), DeviceController.approve);

/**
 * @openapi
 * /api/admin/devices/{id}/assign-hardware:
 *   post: { tags: [Admin], summary: "Cihaza donanım ata (body peripheralIds[])", security: [{ bearerAuth: [] }] }
 */
deviceAdminRouter.post("/:id/assign-hardware", verifyToken, requirePermission("admin:settings"), DeviceController.assignHardware);

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
