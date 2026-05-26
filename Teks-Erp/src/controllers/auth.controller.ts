// =============================================================================
// TeksERP - Auth Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthService } from "../services/auth.service";
import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import "../types/express-augment";

// Zod schemas for validation
const loginSchema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli"),
  password: z.string().min(1, "Şifre gerekli"),
});

const registerSchema = z.object({
  username: z.string().min(3, "Kullanıcı adı en az 3 karakter olmalı"),
  password: z.string().min(6, "Şifre en az 6 karakter olmalı"),
  fullName: z.string().min(1, "Ad soyad gerekli"),
});

export class AuthController {
  /**
   * @openapi
   * /api/auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Kullanıcı girişi
   *     description: Kullanıcı adı ve şifre ile giriş yaparak JWT token alır.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username:
   *                 type: string
   *                 example: admin
   *               password:
   *                 type: string
   *                 example: admin123
   *     responses:
   *       200:
   *         description: Başarılı giriş
   *       401:
   *         description: Geçersiz kimlik bilgisi
   */
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    const body = (() => {
      try {
        return loginSchema.parse(req.body);
      } catch (error) {
        next(error);
        return null;
      }
    })();
    if (!body) return;

    const ipAddress = req.ip ?? null;

    try {
      const result = await AuthService.login(body.username, body.password);

      // SystemLog'a AUTH event (Sistem Kayıtları sayfası bunu okur).
      void AuditService.logEvent({
        category: "AUTH",
        action: "LOGIN_SUCCESS",
        userId: result.user.userId,
        recordId: body.username,
        ipAddress,
      });

      res.status(200).json({
        success: true,
        data: {
          token: result.token,
          user: result.user,
        },
        message: "Giriş başarılı",
      });
    } catch (error) {
      void AuditService.logEvent({
        category: "AUTH",
        action: "LOGIN_FAILED",
        recordId: body.username,
        ipAddress,
        payload: { reason: error instanceof Error ? error.message : "unknown" },
      });
      next(error);
    }
  }

  /**
   * @openapi
   * /api/auth/register:
   *   post:
   *     tags: [Auth]
   *     summary: Yeni kullanıcı kaydı
   *     description: Yeni bir kullanıcı oluşturur (sadece admin yetkisi ile).
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password, fullName]
   *             properties:
   *               username:
   *                 type: string
   *               password:
   *                 type: string
   *               fullName:
   *                 type: string
   *     responses:
   *       201:
   *         description: Kullanıcı oluşturuldu
   *       400:
   *         description: Validasyon hatası
   *       409:
   *         description: Kullanıcı adı zaten mevcut
   */
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = registerSchema.parse(req.body);
      const passwordHash = await AuthService.hashPassword(body.password);

      const user = await prisma.user.create({
        data: {
          username: body.username,
          passwordHash,
          fullName: body.fullName,
        },
        select: {
          id: true,
          username: true,
          fullName: true,
          isActive: true,
          createdAt: true,
        },
      });

      await AuditService.log({
        userId: req.user?.userId,
        action: "CREATE",
        tableName: "USER",
        recordId: user.id,
        newData: { username: user.username, fullName: user.fullName },
      });

      res.status(201).json({
        success: true,
        data: user,
        message: "Kullanıcı başarıyla oluşturuldu",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @openapi
   * /api/auth/mobile-users:
   *   get:
   *     tags: [Auth]
   *     summary: Mobil login ekranı için kullanıcı listesi
   *     description: |
   *       Eşleştirilmiş tabletin login ekranında gösterilecek aktif mobil
   *       kullanıcıları döner — vardiya değişiminde işçi kendi adına dokunup
   *       6 haneli PIN'ini girer. Auth gerekmez ama `x-device-id` header'ı
   *       zorunlu; sadece aktif Device kaydı olan tablet bu listeyi çekebilir.
   *
   *       Listede yalnızca `mobile:*` veya `mobile:<screen>` yetkisi olan
   *       aktif kullanıcılar bulunur; saf admin/web kullanıcıları sızdırılmaz.
   *     parameters:
   *       - in: header
   *         name: x-device-id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Mobil kullanıcı listesi }
   *       401: { description: Eşleştirilmiş cihaz değil }
   */
  static async mobileUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.device) {
        res.status(401).json({
          success: false,
          message: "Bu endpoint sadece eşleştirilmiş tabletlerden çağrılabilir.",
          code: "DEVICE_REQUIRED",
        });
        return;
      }

      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          permissions: {
            some: {
              permission: { code: { startsWith: "mobile:" } },
            },
          },
        },
        select: { id: true, username: true, fullName: true },
        orderBy: { fullName: "asc" },
      });

      res.status(200).json({
        success: true,
        data: users,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @openapi
   * /api/auth/me:
   *   get:
   *     tags: [Auth]
   *     summary: Mevcut kullanıcı bilgisi
   *     description: JWT token'dan mevcut kullanıcının bilgilerini döner.
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Kullanıcı bilgisi
   *       401:
   *         description: Yetkisiz erişim
   */
  static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // JWT payload (req.user) ham `iat`/`exp` claim'lerini içeriyor — domain
      // modelinde anlamı yok, response'a sızdırmıyoruz. `fullName` UI için
      // gerekli ama JWT'de tutulmuyor; tek küçük DB hit (PK by id) ile çekiyoruz.
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: "Token bulunamadı" });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, fullName: true, isActive: true },
      });
      if (!user || !user.isActive) {
        res.status(401).json({ success: false, message: "Kullanıcı bulunamadı veya pasif" });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          userId: user.id,
          username: user.username,
          fullName: user.fullName,
          permissions: req.user?.permissions ?? [],
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @openapi
   * /api/auth/logout:
   *   post:
   *     tags: [Auth]
   *     summary: Çıkış (stateless — frontend token'ı silmeli)
   *     description: |
   *       Stateless logout: backend tarafında bir state tutulmaz çünkü JWT
   *       self-contained ve revoke edilmez. Frontend bu endpoint'i çağırdıktan
   *       sonra token'ı local storage'dan silmeli. Audit log için kullanıcı
   *       çıkış event'i yazılır.
   *
   *       Çalınan/sızan token'ı erken iptal etme ihtiyacı doğarsa blacklist
   *       (in-memory ya da DB) veya refresh-token mimarisi gerek. Şu an Phase 1
   *       kapsamında değil.
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Çıkış kaydedildi }
   *       401: { description: Token yok ya da geçersiz }
   */
  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      void AuditService.logEvent({
        category: "AUTH",
        action: "LOGOUT",
        userId: req.user?.userId,
        recordId: req.user?.username ?? "-",
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({
        success: true,
        message:
          "Çıkış kaydedildi. Token'ı istemci tarafında silin (stateless logout).",
      });
    } catch (error) {
      next(error);
    }
  }
}
