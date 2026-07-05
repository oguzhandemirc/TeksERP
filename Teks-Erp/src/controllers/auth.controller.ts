// =============================================================================
// TeksERP - Auth Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthService } from "../services/auth.service";
import type { LoginContext } from "../services/auth.service";
import { AuditService } from "../services/audit.service";
import { readDevicePairingRequired, readLoginMethods, readCompanyName } from "../services/system-setting.service";
import { SessionRegistryService } from "../services/session-registry.service";
import { AppError } from "../utils/app-error";
import {
  resolveLoginLockoutKey,
  checkLoginLockout,
  recordLoginFailure,
  resetLoginLockout,
} from "../middlewares/login-lockout";
import "../types/express-augment";

// Session/eşzamanlılık: her login yolu clientType (electron|mobile, default mobile) +
// confirmKick ('notify' politikasında "ikisi de açık kalsın" onayı) taşır. deviceId
// request'ten türetilir (req.device.deviceId ya da x-device-id header) — body'de değil.
const clientTypeSchema = z.enum(["electron", "mobile"]).optional();

// Zod schemas for validation
const loginSchema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli"),
  password: z.string().min(1, "Şifre gerekli"),
  clientType: clientTypeSchema,
  confirmKick: z.boolean().optional(),
});

const loginCardSchema = z.object({
  cardCode: z.string().min(1, "Kart kodu gerekli").max(120),
  clientType: clientTypeSchema,
  confirmKick: z.boolean().optional(),
});

const loginQuickPinSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, "PIN 6 haneli rakam olmalı"),
  clientType: clientTypeSchema,
  confirmKick: z.boolean().optional(),
});

/** Login isteğinden cihaz kimliğini çöz: eşleşmiş cihazın deviceId'si öncelikli,
 *  yoksa ham x-device-id header'ı (kayıtsız client de oturum açabilir). Yoksa null. */
function resolveLoginDeviceId(req: Request): string | null {
  if (req.device?.deviceId) return req.device.deviceId;
  const h = req.headers["x-device-id"];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : null;
}

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
    const ctx: LoginContext = {
      clientType: body.clientType,
      deviceId: resolveLoginDeviceId(req),
      confirmKick: body.confirmKick,
    };

    try {
      const result = await AuthService.login(body.username, body.password, ctx);

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
   *     summary: QR personel kartıyla giriş (auth.loginMethods "card" içerirken)
   *     description: Body { cardCode } — "TEKSU:<userId>:<token>". Yöntem kapalıysa 403.
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
    // Deneme kilidi: IP/cihaz başına ardışık yanlış kartı throttle et (brute-force).
    const lockoutKey = resolveLoginLockoutKey(req);
    const lock = await checkLoginLockout(lockoutKey);
    if (lock.blocked) {
      next(
        AppError.tooManyRequests(
          `Çok fazla hatalı giriş denemesi. ${lock.retryAfterSec} saniye sonra tekrar deneyin.`,
          { code: "LOGIN_LOCKED", retryAfterSec: lock.retryAfterSec },
        ),
      );
      return;
    }
    const ctx: LoginContext = {
      clientType: body.clientType,
      deviceId: resolveLoginDeviceId(req),
      confirmKick: body.confirmKick,
    };
    try {
      const result = await AuthService.loginWithCard(body.cardCode, ctx);
      resetLoginLockout(lockoutKey);
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
      await recordLoginFailure(lockoutKey);
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
   * /api/auth/login-quick-pin:
   *   post:
   *     tags: [Auth]
   *     summary: SALT hızlı-PIN ile giriş (auth.loginMethods "pin" içerirken)
   *     description: Body { pin } — kullanıcı seçme yok; PIN benzersiz olduğundan kimliği tek başına belirler.
   *     responses:
   *       200: { description: Başarılı giriş }
   *       401: { description: PIN tanınmadı }
   *       403: { description: Hızlı PIN girişi kapalı }
   */
  static async loginQuickPin(req: Request, res: Response, next: NextFunction): Promise<void> {
    const body = (() => {
      try {
        return loginQuickPinSchema.parse(req.body);
      } catch (error) {
        next(error);
        return null;
      }
    })();
    if (!body) return;

    const ipAddress = req.ip ?? null;
    // Deneme kilidi: IP/cihaz başına ardışık yanlış PIN'i throttle et (brute-force).
    const lockoutKey = resolveLoginLockoutKey(req);
    const lock = await checkLoginLockout(lockoutKey);
    if (lock.blocked) {
      next(
        AppError.tooManyRequests(
          `Çok fazla hatalı giriş denemesi. ${lock.retryAfterSec} saniye sonra tekrar deneyin.`,
          { code: "LOGIN_LOCKED", retryAfterSec: lock.retryAfterSec },
        ),
      );
      return;
    }
    const ctx: LoginContext = {
      clientType: body.clientType,
      deviceId: resolveLoginDeviceId(req),
      confirmKick: body.confirmKick,
    };
    try {
      const result = await AuthService.loginWithQuickPin(body.pin, ctx);
      resetLoginLockout(lockoutKey);
      void AuditService.logEvent({
        category: "AUTH",
        action: "LOGIN_SUCCESS",
        userId: result.user.userId,
        recordId: result.user.username,
        ipAddress,
        payload: { method: "quick-pin" },
      });
      res.status(200).json({
        success: true,
        data: { token: result.token, user: result.user },
        message: "Giriş başarılı",
      });
    } catch (error) {
      await recordLoginFailure(lockoutKey);
      void AuditService.logEvent({
        category: "AUTH",
        action: "LOGIN_FAILED",
        recordId: "quick-pin",
        ipAddress,
        payload: { method: "quick-pin", reason: error instanceof Error ? error.message : "unknown" },
      });
      next(error);
    }
  }

  /**
   * @openapi
   * /api/auth/login-methods:
   *   get:
   *     tags: [Auth]
   *     summary: Mobil giriş yöntemleri (public — login ekranı auth'suz okur)
   *     responses:
   *       200: { description: "{ enabled: (list|pin|card)[], primary }" }
   */
  static async loginMethods(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const methods = await readLoginMethods();
      const companyName = await readCompanyName();
      res.status(200).json({ success: true, data: { ...methods, companyName } });
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
      // Bu oturumu (jti) registry'de iptal et → token silinmese bile bir sonraki
      // istek 401 alır (anlık iptal). Best-effort: iptal yazımı düşse de logout başarılı.
      await SessionRegistryService.revokeSession(req.user?.jti, "LOGOUT").catch(
        () => undefined,
      );

      void AuditService.logEvent({
        category: "AUTH",
        action: "LOGOUT",
        userId: req.user?.userId,
        recordId: req.user?.username ?? "-",
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({
        success: true,
        message: "Çıkış kaydedildi. Oturum iptal edildi — token istemci tarafında da silinmeli.",
      });
    } catch (error) {
      next(error);
    }
  }
}
