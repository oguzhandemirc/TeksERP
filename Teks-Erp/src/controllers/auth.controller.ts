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
      res.status(200).json({
        success: true,
        data: req.user,
      });
    } catch (error) {
      next(error);
    }
  }
}
