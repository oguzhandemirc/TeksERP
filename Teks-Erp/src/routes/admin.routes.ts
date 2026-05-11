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
import { AppError } from "../utils/app-error";
import prisma from "../lib/prisma";
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
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});

const userSelect = {
  id: true,
  username: true,
  fullName: true,
  isActive: true,
  createdAt: true,
} as const;

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

      const exists = await prisma.user.findUnique({
        where: { username: body.username },
        select: { id: true },
      });
      if (exists) throw AppError.conflict("Bu kullanıcı adı zaten kullanılıyor");

      const passwordHash = await AuthService.hashPassword(body.password);
      const user = await prisma.user.create({
        data: {
          username: body.username,
          fullName: body.fullName,
          passwordHash,
          isActive: body.isActive ?? true,
        },
        select: userSelect,
      });

      await AuditService.log({
        userId: req.user?.userId,
        action: "CREATE",
        tableName: "users",
        recordId: user.id,
        newData: { username: user.username, fullName: user.fullName, isActive: user.isActive },
      });

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

      const existing = await prisma.user.findUnique({
        where: { id },
        select: userSelect,
      });
      if (!existing) throw AppError.notFound("Kullanıcı bulunamadı");

      const user = await prisma.user.update({
        where: { id },
        data: body,
        select: userSelect,
      });

      await AuditService.log({
        userId: req.user?.userId,
        action: "UPDATE",
        tableName: "users",
        recordId: id,
        oldData: { fullName: existing.fullName, isActive: existing.isActive },
        newData: body,
      });

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

      const existing = await prisma.user.findUnique({
        where: { id },
        select: { id: true, isActive: true },
      });
      if (!existing) throw AppError.notFound("Kullanıcı bulunamadı");

      const user = await prisma.user.update({
        where: { id },
        data: { isActive: false },
        select: userSelect,
      });

      await AuditService.log({
        userId: req.user?.userId,
        action: "DELETE",
        tableName: "users",
        recordId: id,
        oldData: { isActive: existing.isActive },
        newData: { isActive: false },
      });

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
      const [activeCount, archiveCount, oldest] = await Promise.all([
        prisma.systemLog.count(),
        prisma.systemLogArchive.count(),
        prisma.systemLog.findFirst({
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
      ]);
      res.status(200).json({
        success: true,
        data: { activeCount, archiveCount, oldestLog: oldest?.createdAt ?? null },
      });
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

export default router;
