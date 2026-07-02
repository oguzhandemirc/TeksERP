// =============================================================================
// TeksERP - Auth Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthService } from "../services/auth.service";
import { AuditService } from "../services/audit.service";
import { readDevicePairingRequired, readAuthLoginMode } from "../services/system-setting.service";
import "../types/express-augment";

// Zod schemas for validation
const loginSchema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli"),
  password: z.string().min(1, "Şifre gerekli"),
});

const loginCardSchema = z.object({
  cardCode: z.string().min(1, "Kart kodu gerekli").max(120),
});

// K6 (2026-06-12): register endpoint'i + şeması kaldırıldı — kullanıcı
// oluşturmanın tek yolu POST /api/admin/users (PermissionManagementService).

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
   *                 example: 123123
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
   * /api/auth/login-card:
   *   post:
   *     tags: [Auth]
   *     summary: QR personel kartıyla giriş (auth.loginMode="card" iken)
   *     description: Body { cardCode } — "TEKSU:<userId>:<token>". Mod "pin" ise 403.
   *     responses:
   *       200: { description: Başarılı giriş }
   *       401: { description: Kart geçersiz/iptal }
   *       403: { description: Kartla giriş kapalı }
   */
  static async loginCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const body = (() => {
      try {
        return loginCardSchema.parse(req.body);
      } catch (error) {
        next(error);
        return null;
      }
    })();
    if (!body) return;

    const ipAddress = req.ip ?? null;
    try {
      const result = await AuthService.loginWithCard(body.cardCode);
      void AuditService.logEvent({
        category: "AUTH",
        action: "LOGIN_SUCCESS",
        userId: result.user.userId,
        recordId: result.user.username,
        ipAddress,
        payload: { method: "card" },
      });
      res.status(200).json({
        success: true,
        data: { token: result.token, user: result.user },
        message: "Giriş başarılı",
      });
    } catch (error) {
      void AuditService.logEvent({
        category: "AUTH",
        action: "LOGIN_FAILED",
        recordId: "card",
        ipAddress,
        payload: { method: "card", reason: error instanceof Error ? error.message : "unknown" },
      });
      next(error);
    }
  }

  /**
   * @openapi
   * /api/auth/login-mode:
   *   get:
   *     tags: [Auth]
   *     summary: Mobil giriş yöntemi (public — login ekranı auth'suz okur)
   *     responses:
   *       200: { description: "{ mode: pin | card }" }
   */
  static async loginMode(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const mode = await readAuthLoginMode();
      res.status(200).json({ success: true, data: { mode } });
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
      // Eşleştirme zorunluysa yalnız eşleşmiş tablet listeyi çekebilir. Pasif modda
      // (default) eşleşmemiş cihaz da login ekranı için kullanıcı listesini alabilir.
      if (!req.device && (await readDevicePairingRequired())) {
        res.status(401).json({
          success: false,
          message: "Bu endpoint sadece eşleştirilmiş tabletlerden çağrılabilir.",
          code: "DEVICE_REQUIRED",
        });
        return;
      }

      const users = await AuthService.listMobileUsers();

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

      const user = await AuthService.getActiveUserSummary(userId);
      if (!user) {
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
