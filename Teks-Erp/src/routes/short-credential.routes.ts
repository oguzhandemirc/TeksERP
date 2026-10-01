// =============================================================================
// Kısa kimlikler (hızlı PIN + QR kart) — /api/admin/short-credentials
// =============================================================================
// Durum, anahtarın emanetten geri konması ve toplu hızlı PIN sıfırlama. Yetki zinciri
// `credentials` ucuyla aynı: `admin:settings` + `admin:users` (AND) — toplu sıfırlama
// düz PIN döndürür, anahtar geri koyma yedek parolası ister.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { unlockLocalBackupKeyForRequest } from "../middlewares/backup-password";
import { ShortCredentialService } from "../services/short-credential.service";
import { ShortCredentialAdminService } from "../services/short-credential-admin.service";
import { readShortCredentialApprovedDeviceOnly } from "../services/system-setting.service";
import { isHostedInstallation } from "../services/helpers/install-class.helper";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

const router = Router();

/**
 * @openapi
 * /api/admin/short-credentials/status:
 *   get:
 *     tags: [Admin]
 *     summary: Kısa kimlik durumu — anahtar halkası, özet/düz sayıları, uyuşmayan anahtarlar, emanet
 *     description: Değer döndürmez (PIN/kart/anahtar). Yalnız admin:settings + admin:users.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Durum }
 */
router.get("/status", verifyToken, requirePermission("admin:settings"), requirePermission("admin:users"), async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const status = await ShortCredentialService.status();
    res.status(200).json({
      success: true,
      data: {
        ...status,
        approvedDeviceOnly: await readShortCredentialApprovedDeviceOnly(),
        hostedInstallation: isHostedInstallation(),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/short-credentials/key/restore:
 *   post:
 *     tags: [Admin]
 *     summary: Başka makineden gelen özetlerin anahtarını emanetten geri koy (yedek parolasıyla)
 *     description: >
 *       Yedek parolası `X-Backup-Password` başlığıyla verilir (403 BACKUP_PASSWORD_REQUIRED/INVALID,
 *       429 BACKUP_PASSWORD_LOCKED). Sunucuda yerel yedek anahtarı yoksa 409 LOCAL_BACKUP_KEY_MISSING —
 *       kâğıt müşteri/satıcı anahtarıyla `scripts/kisa-kimlik.ts anahtar-geri-yukle` kullanılır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri konan / açılamayan / emaneti olmayan anahtarlar }
 */
router.post("/key/restore", verifyToken, requirePermission("admin:settings"), requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const identity = await unlockLocalBackupKeyForRequest(req);
    if (!identity) {
      throw AppError.conflict(
        "Bu sunucuda yerel yedek anahtarı yok — anahtarı müşteri ya da Etkili Yazılım kâğıt anahtarıyla sunucu konsolundan geri koyun (kisa-kimlik anahtar-geri-yukle).",
        { code: "LOCAL_BACKUP_KEY_MISSING" },
      );
    }
    const result = await ShortCredentialAdminService.restoreKeysFromEscrow([identity], req.user?.userId ?? null);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

const scopeSchema = z.enum(["uyusmayan", "tumu"]).default("uyusmayan");

/**
 * @openapi
 * /api/admin/short-credentials/bulk-reset/preview:
 *   get:
 *     tags: [Admin]
 *     summary: Toplu hızlı PIN sıfırlama önizlemesi — etkilenen HER kullanıcı
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [uyusmayan, tumu] }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "PIN satırları + yeniden basılması gereken kartlar" }
 */
router.get("/bulk-reset/preview", verifyToken, requirePermission("admin:settings"), requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const scope = scopeSchema.parse(req.query.scope);
    res.status(200).json({ success: true, data: await ShortCredentialAdminService.bulkResetPreview(scope) });
  } catch (error) {
    next(error);
  }
});

const bulkResetSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, "En az bir kullanıcı seçin").max(500),
});

/**
 * @openapi
 * /api/admin/short-credentials/bulk-reset:
 *   post:
 *     tags: [Admin]
 *     summary: Seçili kullanıcılara yeni rastgele hızlı PIN — düz PIN'ler YALNIZ bu cevapta döner
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Kullanıcı başına yeni PIN (yazdırılıp dağıtılır) + atlananlar" }
 */
router.post("/bulk-reset", verifyToken, requirePermission("admin:settings"), requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = bulkResetSchema.parse(req.body ?? {});
    const result = await ShortCredentialAdminService.bulkResetApply(body.userIds, req.user?.userId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
