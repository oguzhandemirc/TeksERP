// =============================================================================
// TeksERP - Admin Routes (Permission Management + Maintenance)
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { AuditService } from "../services/audit.service";
import { AuthService } from "../services/auth.service";
import { PermissionManagementService } from "../services/permission-management.service";
import { systemSettingService } from "../services/system-setting.service";
import { SystemLogService } from "../services/system-log.service";
import { triggerManualBackup, listBackups, resolveBackupPath } from "../services/backup.service";
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
  username: z.string().min(3, "En az 3 karakter").max(40),
  fullName: z.string().min(1, "Ad-soyad gerekli").max(120),
  password: z.string().min(6, "Şifre en az 6 karakter"),
  isActive: z.boolean().optional(),
  // Varsayılan üretim istasyon izinlerini (KK1/KK2/Tambur) ver — default true (saha
  // operatörü). Web/admin kullanıcısı açarken false gönderilir (temiz başlar).
  grantOperatorDefaults: z.boolean().optional(),
  // Mobil kimlik (hızlı PIN + QR kart) otomatik üret — default grantOperatorDefaults.
  generateMobileCredentials: z.boolean().optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
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
 * /api/admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Kullanıcıyı pasife al (soft delete)
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  "/users/:id",
  verifyToken,
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      if (req.user?.userId === id) {
        throw AppError.badRequest("Kendi hesabınızı pasife alamazsınız");
      }
      const user = await PermissionManagementService.deactivateUser(
        id,
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

const setSchema = z.object({
  permissionIds: z.array(z.string().min(1)),
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
      const { permissionIds } = setSchema.parse(req.body);
      const data = await PermissionManagementService.setUserPermissions(
        req.params.id as string,
        permissionIds,
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
      const { value, description } = settingUpsertSchema.parse(req.body);
      const result = await systemSettingService.set(
        req.params.key as string,
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
 *     summary: Şimdi yedek al (gece yedek görevini tetikler)
 *     description: >
 *       Backend pg_dump çalıştırmaz; kurulumdaki "TeksERP Gece Yedek" Görev
 *       Zamanlayıcı görevini tetikler. Ağır iş ayrı SYSTEM prosesinde koşar.
 *       Yalnızca kurulu Windows sunucusunda çalışır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       202: { description: Yedek başlatıldı }
 *       400: { description: Başlatılamadı (Windows değil / görev yok) }
 */
router.post(
  "/backup",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await triggerManualBackup();
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
  requirePermission("admin:settings"),
  (_req: Request, res: Response, next: NextFunction): void => {
    try {
      res.status(200).json({ success: true, ...listBackups() });
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
  requirePermission("admin:settings"),
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      const abs = resolveBackupPath(req.params.name as string);
      if (!abs) {
        next(AppError.notFound("Yedek dosyası bulunamadı."));
        return;
      }
      res.download(abs, req.params.name as string);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
