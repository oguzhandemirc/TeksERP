// =============================================================================
// TeksERP - Auth Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthService } from "../services/auth.service";
import { resolveSystemAccountLock } from "../services/helpers/system-account.registry";
import type { LoginContext } from "../services/auth.service";
import { AuditService } from "../services/audit.service";
import { TotpAccountService } from "../services/totp-account.service";
import { readDevicePairingRequired, readLoginMethods, readCompanyName } from "../services/system-setting.service";
import { SessionRegistryService } from "../services/session-registry.service";
import { AppError } from "../utils/app-error";
import {
  resolveLoginLockoutKeys,
  reserveLoginAttempt,
  resetLoginLockout,
  releaseLoginAttempt,
} from "../middlewares/login-lockout";
import "../types/express-augment";

// Session/eşzamanlılık: her login yolu clientType (electron|mobile, default mobile) +
// confirmKick ('notify' politikasında "ikisi de açık kalsın" onayı) taşır. deviceId
// request'ten türetilir (req.device.deviceId ya da x-device-id header) — body'de değil.
// "web" = tarayıcıdaki panel (Electron kabuğu olmadan aynı React kodu).
// Kendi oturum yuvasını alır; masaüstü izin kapısına electron ile BİRLİKTE tabidir.
const clientTypeSchema = z.enum(["electron", "mobile", "web"]).optional();

// Zod schemas for validation
const loginSchema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli"),
  password: z.string().min(1, "Şifre gerekli"),
  clientType: clientTypeSchema,
  confirmKick: z.boolean().optional(),
  /**
   * İkinci faktör — YALNIZ uzak (tünel) girişlerinde istenir. TOTP kodu (6 hane)
   * ya da kurtarma kodu (XXXX-XXXX) olabilir; ayrımı servis yapar.
   *
   * ⚠️ Uzunluk üst sınırı var: `bcrypt.compare` kurtarma kodu yolunda çağrılıyor
   * ve sınırsız bir metin kabul etmek gereksiz CPU yakardı.
   */
  totpCode: z.string().trim().min(1).max(64).optional(),
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
    // Deneme kilidi — kart/PIN yollarıyla AYNI mekanizma (denetim 2026-08-09,
    // F-KIM-GUV-001). Klasik şifre girişi bu kilide BAĞLI DEĞİLDİ: sınırsız
    // deneme yapılabiliyordu ve her deneme bcryptjs (maliyet 10) hesabını TEK
    // event loop'ta koşturduğu için aynı boşluk hem hesap ele geçirme hem hizmet
    // kesintisi yoluydu.
    //
    // ⚠️ SIRA LOAD-BEARING: rezervasyon `AuthService.login`den (dolayısıyla
    // bcrypt.compare'den) ÖNCE. Ters sırada kilitli bir anahtar da CPU harcamaya
    // devam eder, yani DoS ayağı hiç kapanmaz.
    //
    // ⚠️ ANAHTAR ORTAMA GÖRE İKİ BİÇİMDE (bkz. login-lockout.ts başlığı):
    //  • Fabrika (TRUST_PROXY yok) → TEK anahtar = req.ip, yani BUGÜNKÜ davranış.
    //    Kullanıcı adı bilerek katılmaz: soket IP'si zaten cihaz başınadır ve
    //    kullanıcı adını eklemek password-spraying'e kapı açardı.
    //  • Ters vekil arkasında → İKİ kova: dar (`ip|kullanıcı`, ×1) hesabı korur,
    //    geniş (`ip`, ×5) spraying'i yakalar. Orada tek-IP kilidi ANLAMSIZDIR:
    //    tüm ziyaretçiler kenar IP'sinden gelir ve şifresini yanlış giren ilk
    //    kişi herkesi kilitlerdi.
    // Kimlik olarak kullanıcı adı verilir — SIR DEĞİLDİR (şifre asla anahtara girmez).
    //
    // ⚠️ AYAR PAYLAŞIMI: kilit `auth.pinLockoutEnabled` ile açılıp kapanır
    // (varsayılan TRUE, canlıda ezen kayıt yok → şu an AÇIK). Adı "pin" olsa da
    // artık ŞİFRE girişini de kapsıyor — panelden kapatılırsa üç yol da korumasız
    // kalır. Ayarın etiketi bunu söylemeli.
    const lockoutKey = resolveLoginLockoutKeys(req, `u:${body.username}`);
    const lock = await reserveLoginAttempt(lockoutKey);
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
      // ⚠️ GÖVDEDEN DEĞİL — `remote-access.middleware` soket portundan çözer.
      // Gövdeye açılsaydı internetten gelen biri `isRemote:false` yazıp ikinci
      // faktörü tamamen atlardı.
      isRemote: req.isRemote === true,
      totpCode: body.totpCode,
    };

    try {
      const result = await AuthService.login(body.username, body.password, ctx);
      resetLoginLockout(lockoutKey);

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
      // F49 (kart/PIN ile aynı kural): yalnız 401 brute-force sayılır. 409
      // SESSION_EXISTS / 403 gibi sonuçlar kimlik-bilgisi denemesi DEĞİLDİR →
      // assume-fail rezervasyonunu geri al, yoksa "başka cihazda oturum açık"
      // uyarısını üst üste gören meşru kullanıcı kendini 429'a kilitlerdi.
      const isCredentialError = error instanceof AppError && error.statusCode === 401;
      if (!isCredentialError) releaseLoginAttempt(lockoutKey);
      void AuditService.logEvent({
        category: "AUTH",
        action: isCredentialError ? "LOGIN_FAILED" : "LOGIN_CONFLICT",
        recordId: body.username,
        ipAddress,
        payload: {
          statusCode: error instanceof AppError ? error.statusCode : 500,
          reason: error instanceof Error ? error.message : "unknown",
        },
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
    // ⚠️ KİMLİK = CİHAZ, kart kodu DEĞİL. Kart kodu bir SIRDIR (`TEKSU:<id>:<token>`) —
    // onu kova anahtarına yazmak sırrı bellek-içi bir haritaya taşırdı; üstelik
    // saldırgan her denemede farklı kod gönderdiği için kova hiç dolmaz, yani
    // koruma sessizce KAYBOLURDU. Cihaz kimliği ise tabletler arası ayrım için
    // yeterli: ters vekil arkasında aynı IP'yi paylaşan iki tablet birbirini
    // kilitlemez. Cihaz kimliği yoksa "-" ile tek kovaya düşülür (fabrika davranışı).
    const lockoutKey = resolveLoginLockoutKeys(req, `card:${resolveLoginDeviceId(req) ?? "-"}`);
    // F20: rezervasyon = blok kontrolü + (fail varsayımıyla) sayaç artışı tek atomik çağrıda.
    const lock = await reserveLoginAttempt(lockoutKey);
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
      isRemote: req.isRemote === true,
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
      // F49: yalnız 401 (kimlik-bilgisi hatası) brute-force sayılır. 409 SESSION_EXISTS
      // / 403 (yöntem kapalı / erişim yok) brute-force DEĞİL → assume-fail rezervasyonunu
      // geri al (paylaşımlı tablet 429'a kilitlenmesin). F20: deneme zaten reserve'de sayıldı.
      const isCredentialError = error instanceof AppError && error.statusCode === 401;
      if (!isCredentialError) releaseLoginAttempt(lockoutKey);
      void AuditService.logEvent({
        category: "AUTH",
        action: isCredentialError ? "LOGIN_FAILED" : "LOGIN_CONFLICT",
        recordId: "card",
        ipAddress,
        payload: {
          method: "card",
          statusCode: error instanceof AppError ? error.statusCode : 500,
          reason: error instanceof Error ? error.message : "unknown",
        },
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
    // ⚠️ KİMLİK = CİHAZ, PIN DEĞİL — kart yolundaki gerekçenin aynısı: PIN hem
    // kimlik hem sırdır, anahtara yazılamaz ve her denemede değiştiği için kovayı
    // hiç doldurmazdı.
    const lockoutKey = resolveLoginLockoutKeys(req, `pin:${resolveLoginDeviceId(req) ?? "-"}`);
    // F20: rezervasyon = blok kontrolü + (fail varsayımıyla) sayaç artışı tek atomik çağrıda.
    const lock = await reserveLoginAttempt(lockoutKey);
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
      isRemote: req.isRemote === true,
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
      // F49: yalnız 401 brute-force sayılır; 409/403 assume-fail'i geri al (F20 reserve).
      const isCredentialError = error instanceof AppError && error.statusCode === 401;
      if (!isCredentialError) releaseLoginAttempt(lockoutKey);
      void AuditService.logEvent({
        category: "AUTH",
        action: isCredentialError ? "LOGIN_FAILED" : "LOGIN_CONFLICT",
        recordId: "quick-pin",
        ipAddress,
        payload: {
          method: "quick-pin",
          statusCode: error instanceof AppError ? error.statusCode : 500,
          reason: error instanceof Error ? error.message : "unknown",
        },
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

      // Guard'ın supap dalıyla AYNI yüklem: defter "yok" diyorsa DB'den bir kez
      // doğrular (hesap boot'tan SONRA doğduysa panel kapıyla aynı anda kilitlenir —
      // 2026-09-03 V bulgusu: /auth/me `false` derken PATCH 403 yiyordu).
      const systemAccountExists = await resolveSystemAccountLock();
      res.status(200).json({
        success: true,
        data: {
          userId: user.id,
          username: user.username,
          fullName: user.fullName,
          permissions: req.user?.permissions ?? [],
          // Panel "Modüller" kategorisini SALT-OKUNUR çizerken bu ikisini okur.
          // ⚠️ İkisi de SUNUCUDAN gelir, istemci türetmez: `isSystemAccount`
          // isteğin taze kimliğidir (`verifyToken`), `systemAccountExists`
          // guard'ın emniyet supabının AYNI kaynağıdır — ayrışırsa panel
          // yazılabilir gösterip 403 yerdi (ya da tersi).
          isSystemAccount: req.isSystemAccount === true,
          // ⚠️ `systemAccountExistsKnown()` DEĞİL (2026-09-03, D2 bulgusu).
          // Defter üç durumludur ve "bilinmiyor" hâlinde KAPI KİLİTLİDİR
          // (fail-closed). Ham okuma orada `false` derdi → panel supabı AÇIK
          // çizer, kullanıcı toggle'ı çevirir, sunucu 403 verir ve bandı da
          // çizmediği için sebep hiçbir yerde yazmaz. Boot penceresi ~3 sn'dir
          // ama job 5 denemede düşerse KALICI olur. Tek doğru ayna guard'ın
          // KENDİ yüklemidir (tembel doğrulamalı sürümü — yukarıda).
          systemAccountExists,
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
   *     summary: Çıkış (jti registry ile anlık iptal)
   *     description: |
   *       Bu oturumun jti'si SessionRegistry'de iptal edilir → token silinmese
   *       bile bir SONRAKI istek 401 alır (anlık revoke, best-effort: iptal yazımı
   *       düşse de logout başarılı döner). Frontend yine de token'ı local
   *       storage'dan temizlemeli. Audit log için kullanıcı çıkış event'i yazılır.
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
  /**
   * GET /api/auth/totp/enroll?token= — kurulum penceresini OKU (QR göster).
   *
   * ⚠️ PUBLIC ve bu bilinçlidir: kurulumu yapan kişinin henüz oturumu yoktur
   * (2FA kurulmadan uzaktan giremiyor). Koruma kimlik değil, TOKEN'dır: tek
   * kullanımlık, 15 dk ömürlü ve yalnız `admin:users` taşıyan biri üretebilir.
   */
  static async totpEnrollRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = z.string().uuid().parse(req.query.token);
      const w = await TotpAccountService.readWindow(token);
      res.status(200).json({
        success: true,
        data: {
          username: w.username,
          otpauthUri: w.otpauthUri,
          // Elle giriş için — QR okutamayan cihazlarda tek çıkış yolu.
          secret: w.secret,
          expiresAt: w.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/totp/enroll — kurulumu TAMAMLA.
   * Kurtarma kodları YALNIZ BURADA, bir kez döner; sunucuda hash'li saklanır.
   */
  static async totpEnrollConsume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = z
        .object({ token: z.string().uuid(), code: z.string().trim().min(1).max(16) })
        .parse(req.body);
      const out = await TotpAccountService.consumeWindow(body.token, body.code);
      res.status(200).json({
        success: true,
        data: { username: out.username, recoveryCodes: out.recoveryCodes },
        message:
          "İki adımlı doğrulama kuruldu. Kurtarma kodlarını güvenli bir yere kaydedin — " +
          "bir daha gösterilmeyecek.",
      });
    } catch (error) {
      next(error);
    }
  }

}
