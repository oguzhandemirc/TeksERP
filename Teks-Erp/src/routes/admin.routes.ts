// =============================================================================
// TeksERP - Admin Routes (Permission Management + Maintenance)
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { SCREEN_CATALOG, permissionsWithoutScreen } from "../constants/screen-catalog";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { AuditService } from "../services/audit.service";
import { AuthService } from "../services/auth.service";
import { PermissionManagementService } from "../services/permission-management.service";
import { systemSettingService, SETTING_KEYS } from "../services/system-setting.service";
import { SystemLogService } from "../services/system-log.service";
import { triggerManualBackup, listBackups, resolveBackupPath } from "../services/backup.service";
import {
  getOffsiteHealth,
  testOffsiteRemote,
  writeRcloneDriveToken,
  rcloneConfigPath,
  RCLONE_BIN,
} from "../services/helpers/offsite-backup.helper";
import { readOffsiteRemote, readOffsiteDir } from "../services/system-setting.service";
import { runOffsiteSweepNow } from "../jobs/offsite-sweeper";
import { getRestoreImpact } from "../services/backup-impact.service";
import { latencySnapshot, resetLatencyStats } from "../services/latency-stats.service";
import {
  getLatencyPersistHealth,
  latencyHistory,
  latencyHistoryRoutes,
} from "../services/latency-persist.service";
import { SessionRegistryService } from "../services/session-registry.service";
import { AppError } from "../utils/app-error";
import { z } from "zod";
import "../types/express-augment";

const router = Router();

// =============================================================================
// PERMISSION CATALOG
// =============================================================================

/**
 * @openapi
 * /api/admin/permissions:
 *   get:
 *     tags: [Admin]
 *     summary: Yetki kataloğu
 *     description: Sistemdeki tüm permission kayıtları (admin UI için).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Permission listesi }
 */
router.get(
  "/permissions",
  verifyToken,
  requirePermission("admin:users"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await PermissionManagementService.listPermissions();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/screens:
 *   get:
 *     tags: [Admin]
 *     summary: Ekran manifestosu — hangi ekran hangi yetkiyi ister
 *     description: |
 *       Yetki mimarisinin 2. katmanı (docs/design/YETKI-MIMARISI.md). Atama
 *       ekranındaki "Ekrana göre" görünümü ve "neden giremiyor" teşhisi bunu
 *       kullanır. İKİ istemciye de buradan servis edilir — mobil/Electron aynası
 *       AÇILMAZ.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Ekran listesi + ekranı olmayan izinler }
 */
router.get(
  "/screens",
  verifyToken,
  requirePermission("admin:users"),
  (_req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      data: {
        screens: SCREEN_CATALOG,
        // Panelin "bu yetki hiçbir ekranda kullanılmıyor" bandı için — bugün boş,
        // ama yeni izin eklenip ekrana bağlanmazsa BURADA görünür.
        withoutScreen: permissionsWithoutScreen(),
      },
    });
  }
);

// =============================================================================
// USERS
// =============================================================================

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Kullanıcı listesi
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/users",
  verifyToken,
  requirePermission("admin:users"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await PermissionManagementService.listUsers();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

const createUserSchema = z.object({
  // Kullanıcı adı: YALNIZ İngilizce harf ve rakam — özel karakter/boşluk/Türkçe
  // karakter yok (mobil login + benzersizlik + URL güvenliği).
  username: z
    .string()
    .trim()
    .min(3, "En az 3 karakter")
    .max(40)
    .regex(/^[a-zA-Z0-9]+$/, "Yalnız İngilizce harf ve rakam kullanılabilir (özel karakter, boşluk ve Türkçe karakter yok)"),
  fullName: z.string().trim().min(1, "Ad-soyad gerekli").max(120),
  password: z.string().min(6, "Şifre en az 6 karakter"),
  isActive: z.boolean().optional(),
  // Varsayılan üretim istasyon izinlerini (KK1/KK2/Tambur) ver — default true (saha
  // operatörü). Web/admin kullanıcısı açarken false gönderilir (temiz başlar).
  grantOperatorDefaults: z.boolean().optional(),
  // Mobil kimlik (hızlı PIN + QR kart) otomatik üret — default grantOperatorDefaults.
  generateMobileCredentials: z.boolean().optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  // isActive ARTIK burada YOK — aktiflik yalnız deactivate/reactivate/delete
  // uçlarından yönetilir (guard'lar + oturum düşürme orada).
});

/**
 * @openapi
 * /api/admin/users:
 *   post:
 *     tags: [Admin]
 *     summary: Yeni kullanıcı oluştur
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/users",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createUserSchema.parse(req.body);
      const user = await PermissionManagementService.createUser(
        body,
        req.user?.userId
      );
      res.status(201).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Kullanıcı detayı — kimlik + yetki sayısı + son çalışma oturumu (Ayak İzi başlığı)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/users/:id",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const data = await PermissionManagementService.getUserById(id);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Kullanıcıyı güncelle (fullName / isActive)
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  "/users/:id",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const body = updateUserSchema.parse(req.body);
      const user = await PermissionManagementService.updateUser(
        id,
        body,
        req.user?.userId
      );
      res.status(200).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}/deactivate:
 *   post:
 *     tags: [Admin]
 *     summary: Kullanıcıyı GEÇİCİ pasife al (geri alınabilir — reactivate ile)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/users/:id/deactivate",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await PermissionManagementService.deactivateUser(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}/reactivate:
 *   post:
 *     tags: [Admin]
 *     summary: Pasif kullanıcıyı yeniden aktifleştir (silinmişlerde çalışmaz)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/users/:id/reactivate",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await PermissionManagementService.reactivateUser(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Kullanıcıyı KALICI sil (GERİ ALINAMAZ — kayıt yalnız geçmiş için durur)
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  "/users/:id",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await PermissionManagementService.deleteUser(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}/permissions:
 *   get:
 *     tags: [Admin]
 *     summary: Kullanıcının direct grant'ları
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get(
  "/users/:id/permissions",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await PermissionManagementService.getUserPermissions(req.params.id as string);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

const grantSchema = z.object({
  permissionId: z.string().min(1),
  validFrom: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
})
  // F256: geçerlilik penceresi tutarlı olmalı (aksi halde ölü/hatalı yetki).
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil > v.validFrom, {
    message: "Bitiş tarihi başlangıç tarihinden sonra olmalı",
    path: ["validUntil"],
  })
  .refine((v) => !v.validUntil || v.validUntil > new Date(), {
    message: "Bitiş tarihi gelecekte olmalı (geçmiş tarih ölü yetki yaratır)",
    path: ["validUntil"],
  });

/**
 * @openapi
 * /api/admin/users/{id}/permissions:
 *   post:
 *     tags: [Admin]
 *     summary: Kullanıcıya tek yetki ekle (validFrom/validUntil opsiyonel)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/users/:id/permissions",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = grantSchema.parse(req.body);
      const data = await PermissionManagementService.grantPermission(
        req.params.id as string,
        body,
        req.user?.userId
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Toplu-set: yeni tarih-taşır şekil { permissions: [{permissionId, validFrom?, validUntil?}] }
// VEYA geriye-uyum düz { permissionIds: string[] }. En az biri gerekli — normalize edilir.
const permissionSetItemSchema = z
  .object({
    permissionId: z.string().min(1),
    validFrom: z.coerce.date().nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
  })
  // F256: her yetki kaleminde geçerlilik penceresi tutarlı olmalı.
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil > v.validFrom, {
    message: "Bitiş tarihi başlangıç tarihinden sonra olmalı",
    path: ["validUntil"],
  })
  .refine((v) => !v.validUntil || v.validUntil > new Date(), {
    message: "Bitiş tarihi gelecekte olmalı (geçmiş tarih ölü yetki yaratır)",
    path: ["validUntil"],
  });
const setSchema = z
  .object({
    permissions: z.array(permissionSetItemSchema).optional(),
    permissionIds: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => v.permissions !== undefined || v.permissionIds !== undefined, {
    message: "permissions veya permissionIds gerekli",
  });

/**
 * @openapi
 * /api/admin/users/{id}/permissions:
 *   put:
 *     tags: [Admin]
 *     summary: Kullanıcının yetkilerini toplu set'le (idempotent)
 *     description: Body'deki permissionIds listesi yeni hedef state olur.
 *     security: [{ bearerAuth: [] }]
 */
router.put(
  "/users/:id/permissions",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = setSchema.parse(req.body);
      const payload =
        parsed.permissions ??
        (parsed.permissionIds ?? []).map((permissionId) => ({ permissionId }));
      const data = await PermissionManagementService.setUserPermissions(
        req.params.id as string,
        payload,
        req.user?.userId
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}/permissions/{permissionId}:
 *   delete:
 *     tags: [Admin]
 *     summary: Kullanıcıdan tek yetki kaldır
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  "/users/:id/permissions/:permissionId",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await PermissionManagementService.revokePermission(
        req.params.id as string,
        req.params.permissionId as string,
        req.user?.userId
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

const resetPasswordSchema = z.object({
  password: z.string().min(6, "Şifre en az 6 karakter olmalı"),
});

/**
 * @openapi
 * /api/admin/users/{id}/reset-password:
 *   post:
 *     tags: [Admin]
 *     summary: Kullanıcı şifresini sıfırla (admin)
 *     description: Eski şifre sorulmaz; yalnızca admin:users yetkisi yeterli.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/users/:id/reset-password",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { password } = resetPasswordSchema.parse(req.body);
      await PermissionManagementService.resetUserPassword(
        req.params.id as string,
        password,
        req.user?.userId
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}/card-token:
 *   post:
 *     tags: [Admin]
 *     summary: Personel kartı sırrını üret/YENİLE (rotasyon) — QR kart basımı için
 *     description: Yeni 32-hex token yazılır; dönen cardCode ("TEKSU:...") QR olarak basılır. Eski kart anında geçersiz; açık oturumlar etkilenmez.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/users/:id/card-token",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await AuthService.rotateCardToken(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/users/{id}/credentials:
 *   get:
 *     tags: [Admin]
 *     summary: Kullanıcının mobil kimlik bilgileri (hızlı PIN + QR kart kodu) — admin panel
 *     description: Panel bunları her zaman gösterir (kart QR sürekli görünür, mevcut PIN görünür). Yalnız admin:users.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/users/:id/credentials",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await AuthService.getUserCredentials(req.params.id as string);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

const quickPinSchema = z.object({
  // pin verilmezse rastgele üretilir; clear=true PIN'i kaldırır.
  pin: z.string().regex(/^\d{6}$/, "Hızlı PIN 6 haneli rakam olmalı").optional(),
  clear: z.boolean().optional(),
});

/**
 * @openapi
 * /api/admin/users/{id}/quick-pin:
 *   post:
 *     tags: [Admin]
 *     summary: Hızlı PIN ata/üret/kaldır (salt-PIN girişi için — benzersiz)
 *     description: Body { pin? (6 hane), clear? }. pin yoksa çakışmayan rastgele üretilir; başkasında varsa 409.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/users/:id/quick-pin",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = quickPinSchema.parse(req.body ?? {});
      const result = await AuthService.setQuickPin(
        req.params.id as string,
        body,
        req.user?.userId
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

const applyTemplateSchema = z.object({
  templateId: z.string().min(1),
  mode: z.enum(["merge", "replace"]).default("merge"),
});

/**
 * @openapi
 * /api/admin/users/{id}/apply-template:
 *   post:
 *     tags: [Admin]
 *     summary: Şablonu kullanıcıya uygula (kopyala — runtime bağı olmaz)
 *     description: |
 *       merge: mevcut yetkilere ekler. replace: mevcut yetkileri tamamen değiştirir.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/users/:id/apply-template",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = applyTemplateSchema.parse(req.body);
      const data = await PermissionManagementService.applyTemplate(
        req.params.id as string,
        body.templateId,
        body.mode,
        req.user?.userId
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// PERMISSION TEMPLATES (admin UI kısayolu — runtime'da kullanıcıya bağlı değil)
// =============================================================================

/**
 * @openapi
 * /api/admin/permission-templates:
 *   get:
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/permission-templates",
  verifyToken,
  requirePermission("admin:users"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await PermissionManagementService.listTemplates();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/permission-templates/:id",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await PermissionManagementService.getTemplate(req.params.id as string);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  permissionIds: z.array(z.string().min(1)).min(1),
});

router.post(
  "/permission-templates",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createTemplateSchema.parse(req.body);
      const data = await PermissionManagementService.createTemplate(body, req.user?.userId);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  permissionIds: z.array(z.string().min(1)).optional(),
  // Sistem rolünün "silinmesi" pasifleştirmedir (bkz. deleteTemplate) — geri
  // açma yolu olmadan o karar tek yönlü olurdu.
  isActive: z.boolean().optional(),
});

router.patch(
  "/permission-templates/:id",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateTemplateSchema.parse(req.body);
      const data = await PermissionManagementService.updateTemplate(
        req.params.id as string,
        body,
        req.user?.userId
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/permission-templates/:id",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await PermissionManagementService.deleteTemplate(req.params.id as string, req.user?.userId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// ENDPOINT GECİKME İSTATİSTİKLERİ (latency-stats — saf bellek, DB yok)
// =============================================================================

/**
 * @openapi
 * /api/admin/perf:
 *   get:
 *     tags: [Admin]
 *     summary: Endpoint gecikme istatistikleri
 *     description: >
 *       Route bazında count/errCount/p50/p95/max (bucket-yaklaşık) + son yavaş
 *       istekler (≥1sn, son 50). Süreç başlangıcından (veya son reset'ten) beri.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/perf",
  verifyToken,
  requirePermission("admin:settings"),
  (_req: Request, res: Response, next: NextFunction): void => {
    try {
      res.status(200).json({
        success: true,
        // persist: kalıcılaştırma sağlığı (flush hataları /health'teki audit
        // sayacı deseniyle burada görünür — sessiz veri kaybı olmasın).
        data: { ...latencySnapshot(), persist: getLatencyPersistHealth() },
      });
    } catch (error) {
      next(error);
    }
  }
);

const perfHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
  route: z.string().min(1).max(200).optional(),
});

/**
 * @openapi
 * /api/admin/perf/history:
 *   get:
 *     tags: [Admin]
 *     summary: Endpoint gecikme günlük geçmişi (kalıcı özetlerden)
 *     description: >
 *       Gün bazlı seri — route verilirse o uç, verilmezse tüm uçların birleşik
 *       toplamı. Persentiller birleşik bucket'lardan hesaplanır (grafik-hazır).
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/perf/history",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { days, route } = perfHistoryQuerySchema.parse(req.query);
      const series = await latencyHistory(days, route);
      const routes = await latencyHistoryRoutes(days);
      res.status(200).json({
        success: true,
        data: { days, route: route ?? null, series, routes },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/perf/reset:
 *   post:
 *     tags: [Admin]
 *     summary: Gecikme sayaçlarını sıfırla
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/perf/reset",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      resetLatencyStats();
      // Best-effort audit (tx yok — saf bellek işlemi ama state değişikliği iz bırakır).
      await AuditService.log({
        userId: req.user?.userId,
        action: "DELETE",
        tableName: "latency_stats",
        recordId: "in-memory",
        newData: { resetAt: new Date().toISOString() },
      });
      res.status(200).json({ success: true, data: { reset: true } });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// SESSIONS BAKIMI (jti registry — ölü satır temizliği, Faz 3)
// =============================================================================

const sessionPurgeSchema = z.object({
  olderThanDays: z.number().int().min(7).max(365).default(90),
});

/**
 * @openapi
 * /api/admin/sessions/purge:
 *   post:
 *     tags: [Admin]
 *     summary: Ölü oturum kayıtlarını temizle
 *     description: >
 *       revokedAt/expiresAt değeri eşikten eski oturum satırlarını fiziksel
 *       siler; aktif oturumlar matematiksel olarak kapsam dışıdır (bkz.
 *       SessionRegistryService.purgeDeadSessions). Operasyonel bakım —
 *       6 ayda bir system-logs arşiviyle birlikte koşun.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/sessions/purge",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { olderThanDays } = sessionPurgeSchema.parse(req.body ?? {});
      const result = await SessionRegistryService.purgeDeadSessions(olderThanDays);
      await AuditService.log({
        userId: req.user?.userId,
        action: "DELETE",
        tableName: "sessions",
        recordId: "purge",
        newData: { olderThanDays, deleted: result.deleted },
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// SYSTEM LOG MAINTENANCE (mevcut endpoint'ler)
// =============================================================================

const archiveSchema = z.object({
  monthsToKeep: z.number().int().min(1).max(120),
});

/**
 * @openapi
 * /api/admin/system-logs/archive:
 *   post:
 *     tags: [Admin]
 *     summary: Eski sistem loglarını arşivle
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/system-logs/archive",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { monthsToKeep } = archiveSchema.parse(req.body);
      const result = await AuditService.archiveOlderThan(monthsToKeep);
      // F230: binlerce satırı fiziksel taşıyan yıkıcı bakım — kardeş uçlar (perf/reset,
      // sessions/purge, backup) gibi logla. Best-effort (tx dışında, hata isteği düşürmez).
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "AUDIT_ARCHIVE",
        userId: req.user?.userId ?? null,
        payload: { monthsToKeep, archived: result.archived, cutoff: result.cutoff },
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/system-logs/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Sistem log tablo boyutu istatistikleri
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/system-logs/stats",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await AuditService.getLogStats();
      res.status(200).json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// SYSTEM LOG READ (Aktivite Günlüğü)
// =============================================================================
// Yüksek hacimli tablo — cursor pagination, count yok, payload listede yok.
// =============================================================================

const systemLogListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  userId: z.string().uuid().optional(),
  tableName: z.string().min(1).max(100).optional(),
  // TEK KAYDIN geçmişi (Faz B1). `tableName` ile birlikte verilir — index'in
  // ilk kolonu odur; yalnız `recordId` göndermek seq scan üretir.
  recordId: z.string().min(1).max(64).optional(),
  // category: tekil "DOMAIN" / "AUTH" / "SYSTEM" veya virgülle ayrılmış "AUTH,SYSTEM".
  category: z
    .string()
    .regex(/^[A-Z_,]+$/i, "Geçersiz kategori")
    .max(60)
    .optional(),
  // action artık DOMAIN için CREATE/UPDATE/DELETE, AUTH için LOGIN_*, SYSTEM için STARTUP/ERROR.
  // Listede serbest string kabul edilir (frontend hardcoded enum gönderir).
  action: z.string().min(1).max(40).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

/**
 * @openapi
 * /api/admin/system-logs:
 *   get:
 *     tags: [Admin]
 *     summary: Sistem log listesi (cursor pagination, JSON payload listede yok)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/system-logs",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = systemLogListQuerySchema.parse(req.query);
      const result = await SystemLogService.list(params);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/system-logs/users:
 *   get:
 *     tags: [Admin]
 *     summary: Filter dropdown — log'u olan kullanıcılar
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/system-logs/users",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await SystemLogService.listActiveUsers();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/system-logs/tables:
 *   get:
 *     tags: [Admin]
 *     summary: Filter dropdown — sistemde log'u olan tablo adları
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/system-logs/tables",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await SystemLogService.listActiveTables();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/system-logs/archive:
 *   get:
 *     tags: [Admin]
 *     summary: Arşivlenmiş log listesi (cursor pagination)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/system-logs/archive",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = systemLogListQuerySchema.parse(req.query);
      const result = await SystemLogService.listArchive(params);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/system-logs/archive/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Tek arşiv kaydı (oldData/newData JSON dahil)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/system-logs/archive/:id",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await SystemLogService.findArchiveById(req.params.id as string);
      res.status(result.success ? 200 : 404).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/system-logs/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Tek log kaydı (oldData/newData JSON dahil)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/system-logs/:id",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await SystemLogService.findById(req.params.id as string);
      res.status(result.success ? 200 : 404).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// SYSTEM SETTINGS (key-value runtime config)
// =============================================================================

const settingUpsertSchema = z.object({
  value: z.string().max(2000),
  description: z.string().max(500).optional(),
});

// F233: yapılandırılmış JSON tutan anahtarlar — kendi tipli ekranları var
// (setFeatureFlags: travelerCardConfig/documentsConfig/loginMethods). Generic
// PUT /settings/:key düz string yazarak bu JSON'ları bozmasın.
const STRUCTURED_SETTING_KEYS = new Set<string>([
  SETTING_KEYS.TRAVELER_CARD_CONFIG,
  SETTING_KEYS.DOCUMENTS_CONFIG,
  SETTING_KEYS.AUTH_LOGIN_METHODS,
]);

/**
 * @openapi
 * /api/admin/settings:
 *   get:
 *     tags: [Admin]
 *     summary: Tüm sistem ayarları
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Setting listesi }
 */
router.get(
  "/settings",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await systemSettingService.list();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/settings/{key}:
 *   put:
 *     tags: [Admin]
 *     summary: Sistem ayarı güncelle (yoksa oluştur)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value: { type: string }
 *               description: { type: string }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.put(
  "/settings/:key",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.params.key as string;
      if (STRUCTURED_SETTING_KEYS.has(key)) {
        throw AppError.badRequest(
          "Bu ayar yapılandırılmış JSON içerir — kendi tipli ekranından güncelleyin, düz metinle değiştirilemez",
        );
      }
      const { value, description } = settingUpsertSchema.parse(req.body);
      const result = await systemSettingService.set(
        key,
        value,
        description,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// MANUEL YEDEK
// =============================================================================

/**
 * @openapi
 * /api/admin/backup:
 *   post:
 *     tags: [Admin]
 *     summary: Şimdi yedek al (pg_dump → doğrula → rotasyon → offsite)
 *     description: >
 *       Yedeği başlatır ve HEMEN döner (büyük DB'de dakikalar sürer). pg_dump ayrı
 *       bir child process'te koşar, backend bloklanmaz. Sonuç GET /api/admin/backups
 *       yanıtındaki `running` / `lastResult` alanlarından izlenir. BACKUP_DIR ve
 *       DATABASE_URL tanımlı olmalıdır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       202: { description: Yedek başlatıldı }
 *       400: { description: Başlatılamadı (yedek sürüyor / BACKUP_DIR yok / DATABASE_URL çözülemedi) }
 */
router.post(
  "/backup",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = triggerManualBackup();
      // İz: kim ne zaman manuel yedek tetikledi (best-effort).
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "BACKUP_TRIGGER",
        userId: req.user?.userId ?? null,
        payload: { started: result.started },
      });
      res
        .status(result.started ? 202 : 400)
        .json({ success: result.started, message: result.message });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/backups:
 *   get:
 *     tags: [Admin]
 *     summary: Yedek (.dump) dosyalarının listesi
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yedek listesi + yedek klasörü }
 */
router.get(
  "/backups",
  verifyToken,
  // F287: pg_dump .dump TÜM kullanıcıların düz quickPin/cardToken'ını içerir →
  // admin:users da ZORUNLU (zincir = AND). admin:* her ikisini karşılar; yalnız
  // salt-admin:settings aktör 403 alır (mobil giriş sırlarını yedekten harvest edemez).
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json({ success: true, ...(await listBackups()) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/backups/{name}/download:
 *   get:
 *     tags: [Admin]
 *     summary: Bir yedek dosyasını indir
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Dosya akışı }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/backups/:name/download",
  verifyToken,
  // F287: yedek düz-metin giriş sırları içerir → admin:settings + admin:users (AND).
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const name = req.params.name as string;
      const abs = resolveBackupPath(name);
      if (!abs) {
        next(AppError.notFound("Yedek dosyası bulunamadı."));
        return;
      }
      // F235: hassas DB dump'ının indirilmesini izle (kim/ne zaman) — BACKUP_TRIGGER
      // ile aynı best-effort desen.
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "BACKUP_DOWNLOAD",
        userId: req.user?.userId ?? null,
        payload: { name },
      });
      res.download(abs, name);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/backups/{name}/restore-impact:
 *   get:
 *     tags: [Admin]
 *     summary: Bir yedeğe dönülürse ne kaybedilir (geri yükleme etki önizlemesi)
 *     description: >
 *       Yedeğin kesim anından SONRA oluşmuş kayıtları sayar ve audit izinden
 *       toplam değişiklik hacmini çıkarır. Geri yükleme onay dialogu bunu gösterir;
 *       kök CLAUDE.md'nin "yıkıcı işlemde etkilenen kayıtları somut listele"
 *       kuralının geri yükleme karşılığıdır. Sayımlar yalnız INSERT'leri yakalar —
 *       UPDATE'ler audit rollup'ında görünür (yanıttaki `audit` alanı).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Etki önizlemesi }
 *       403: { description: Yetki yok (admin:settings + admin:users gerekli) }
 *       404: { description: Yedek dosyası bulunamadı }
 */
router.get(
  "/backups/:name/restore-impact",
  verifyToken,
  // Zincir /backups ve /download ile BİREBİR AYNI (F287). Zayıflatmayın: yalnız
  // her ikisine sahip aktör zaten geri yükleyebilir; ayrı bir eşik bırakmak
  // "önizleme görünüyor ama komut kurulamıyor" gibi kafa karıştırıcı bir
  // kısmi-erişim durumu üretir.
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const name = req.params.name as string;
      const data = await getRestoreImpact(name);
      if (!data) {
        next(AppError.notFound("Yedek dosyası bulunamadı."));
        return;
      }
      // Bu iz KRİTİK: gerçek geri yükleme backend'de çalışmadığı için "kim, hangi
      // yedeğe dönmeyi düşündü" sorusunun tek cevabı burası. Best-effort.
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "BACKUP_RESTORE_PREVIEW",
        userId: req.user?.userId ?? null,
        payload: {
          name,
          cutoff: data.cutoff.at,
          cutoffSource: data.cutoff.source,
          totalCreated: data.totalCreated,
          canRestore: data.canRestore,
        },
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// OFFSITE YEDEK — durum / ayar / test / elle süpürme / Drive yetkilendirme
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ İZİN ZİNCİRİ AYRIMI — GEVŞETMEYİN.
// AYAR YAZAN uçlar `/backups` ile AYNI zinciri taşır (`admin:settings` VE
// `admin:users`). Sebep F287'nin devamı: `.dump` dosyası TÜM kullanıcıların düz
// `quickPin`/`cardToken`'ını içerir, bu yüzden yedek İNDİRME iki izin ister.
// Offsite hedefini değiştirebilen biri, indirmeye hiç dokunmadan aynı dosyaların
// KENDİ bulutuna teslim edilmesini sağlayabilir — yani tek izinle bırakmak,
// kapatılmış kapının yanına ikinci bir kapı açmak olurdu.
// SALT-OKUMA ve TETİKLEME uçları (`durum`, `test`, `süpür`) yalnız
// `admin:settings` ister: yeni bir hedef tanımlamazlar, var olan yapılandırmayı
// çalıştırır ya da okurlar.

/** Offsite durumu + mevcut yapılandırma (sırlar HARİÇ). */
router.get(
  "/backups/offsite",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [health, remote, dir] = await Promise.all([
        getOffsiteHealth(),
        readOffsiteRemote(),
        readOffsiteDir(),
      ]);
      res.status(200).json({
        success: true,
        data: {
          ...health,
          config: {
            remote,
            localDir: dir,
            // Token DEĞİL, yalnız YOLU — kurulum yapan kişinin bilmesi gereken tek şey.
            configPath: rcloneConfigPath(),
            rcloneBin: RCLONE_BIN(),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

const offsiteConfigSchema = z
  .object({
    // Boş string MEŞRU ve "kapat" demektir — aksi halde panelden hedefi silmek
    // imkânsız olurdu (silince env geri gelirdi).
    remote: z.string().trim().max(200).optional(),
    localDir: z.string().trim().max(400).optional(),
  })
  .refine((v) => v.remote !== undefined || v.localDir !== undefined, {
    message: "En az bir alan gönderilmeli",
  });

/** Offsite hedeflerini ayarla (SystemSetting → pm2 restart GEREKMEZ). */
router.patch(
  "/backups/offsite",
  verifyToken,
  requirePermission("admin:settings"),
  requirePermission("admin:users"), // ← yukarıdaki gerekçe: hedef = yedeklerin gideceği yer
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = offsiteConfigSchema.parse(req.body);
      const userId = req.user?.userId;
      if (body.remote !== undefined) {
        await systemSettingService.set(
          SETTING_KEYS.BACKUP_OFFSITE_REMOTE,
          body.remote,
          "Offsite uzak hedef (rclone)",
          userId
        );
      }
      if (body.localDir !== undefined) {
        await systemSettingService.set(
          SETTING_KEYS.BACKUP_OFFSITE_DIR,
          body.localDir,
          "Offsite yerel ikinci hedef (ağ paylaşımı / ikinci disk)",
          userId
        );
      }
      const [remote, localDir] = await Promise.all([readOffsiteRemote(), readOffsiteDir()]);
      res.status(200).json({ success: true, data: { remote, localDir } });
    } catch (error) {
      next(error);
    }
  }
);

/** Uzak hedefe bağlanılabiliyor mu. Yeni hedef TANIMLAMAZ → tek izin yeter. */
router.post(
  "/backups/offsite/test",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({ success: true, data: await testOffsiteRemote() });
    } catch (error) {
      next(error);
    }
  }
);

/** Süpürmeyi ŞİMDİ koştur. Var olan yapılandırmayı çalıştırır → tek izin yeter. */
router.post(
  "/backups/offsite/sweep",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await runOffsiteSweepNow();
      res.status(200).json({ success: true, data: await getOffsiteHealth() });
    } catch (error) {
      next(error);
    }
  }
);

const offsiteTokenSchema = z.object({
  name: z.string().trim().min(1).max(32),
  token: z.string().trim().min(20).max(8000),
});

/**
 * `rclone authorize "drive"` çıktısındaki token'ı yapılandırmaya yazar.
 *
 * ⚠️ Token yanıtta GERİ DÖNMEZ ve audit payload'ına YAZILMAZ — bir Google
 * yenileme anahtarı, hesabın Drive'ına süresiz erişimdir. Audit yalnız OLAYI
 * kaydeder (kim, ne zaman, hangi hedef adı).
 */
router.post(
  "/backups/offsite/authorize",
  verifyToken,
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = offsiteTokenSchema.parse(req.body);
      const result = await writeRcloneDriveToken(body.name, body.token);
      if (!result.ok) throw AppError.badRequest(result.message);
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "OFFSITE_REMOTE_AUTHORIZED",
        userId: req.user?.userId ?? null,
        payload: { remoteName: body.name, configPath: result.configPath },
      });
      res.status(200).json({ success: true, data: { message: result.message } });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
