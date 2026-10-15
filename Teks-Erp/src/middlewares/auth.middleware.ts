// =============================================================================
// TeksERP - JWT Authentication Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import {
  AuthService,
  PASSWORD_CHANGE_REQUIRED_CODE,
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
} from "../services/auth.service";
import { AppError } from "../utils/app-error";
import { readClientVersionHeader } from "../constants/client-info";
import { touchUser } from "../lib/presence";
import prisma from "../lib/prisma";
import { uyari } from "../lib/logger";
import {
  isSealRejected,
  isSystemAccountAuthorized,
  reportInvalidSeal,
  completeSealRow,
  SEAL_SCALAR_SELECT,
} from "../services/helpers/system-account-seal.helper";
import { ClientType } from "@prisma/client";
import {
  clearSessionCookie,
  hasCsrfHeader,
  isSafeMethod,
  readRequestToken,
} from "../lib/web-session-cookie";

/**
 * Session.lastSeenAt yazımını cihaz başına (jti) kısıtla — her istekte DB update
 * yerine en fazla LAST_SEEN_THROTTLE_MS'de bir. touchUser gibi fire-and-forget +
 * bellekte (tek-process invariant). Restart'ta sıfırlanır (kalıcı defter değil).
 */
const lastSeenWrites = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 60_000;

/**
 * Sürüm yazımı DENENMİŞ oturumlar (jti). `lastSeenAt` kısıtlamasından AYRI
 * tutulur, çünkü ikisinin sorusu farklıdır:
 *   · `lastSeenAt` her dakika tazelenmek ister → kısıtlama bir MALİYET aracıdır.
 *   · `clientVersion` oturum başına BİR KEZ dolar → kısıtlama onu 60 sn
 *     GECİKTİRİR, ki ilk isteği sürümsüz giden panelde (sürüm main process'ten
 *     ASENKRON okunuyor, ölçüm 2026-09-17) satır boş yere bir dakika NULL kalırdı.
 * Budanması zararsızdır: yazım zaten `clientVersion IS NULL` koşulludur, ikinci
 * deneme no-op'tur.
 */
const versionWrites = new Set<string>();

/** exp claim'i OLMAYAN eski token'lar (mutlak tavan 0 + zaman aşımı kapalıyken üretilmiş) —
 *  geçiş süresince KABUL edilir, oturum başına bir kez uyarılır; bir sonraki giriş exp'li alır. */
const warnedExpLessJtis = new Set<string>();

/** Session.revokeReason → operatöre gösterilecek NET Türkçe mesaj. Yanlış
 *  "oturum süresi doldu" bildirimini önler (asıl sebep: kick / şifre / pasif). */
const SESSION_REVOKE_MESSAGES: Record<string, string> = {
  NEW_LOGIN: "Bu hesapla başka bir cihazdan giriş yapıldığı için buradaki oturum kapatıldı.",
  PASSWORD_RESET: "Şifreniz değiştiği için oturumunuz kapatıldı. Tekrar giriş yapın.",
  DEACTIVATED: "Hesabınız pasife alındığı için oturumunuz kapatıldı.",
  DELETED: "Hesabınız kaldırıldığı için oturumunuz kapatıldı.",
  LOGOUT: "Oturumunuz kapatıldı. Tekrar giriş yapın.",
  SESSION_LIMIT: "Bu hesapta açık oturum sınırı aşıldığı için en eski oturum kapatıldı. Tekrar giriş yapın.",
};

function touchSessionLastSeen(jti: string, clientVersion: string | null): void {
  const now = Date.now();
  // ⚠️ SÜRÜM YAZIMI KISITLAMAYA TAKILMAZ: login anında sürümsüz giden bir
  // oturumun satırı, ilk sürümlü istekte HEMEN dolsun (aşağıdaki gerekçe).
  const willWriteVersion = clientVersion !== null && !versionWrites.has(jti);
  const prev = lastSeenWrites.get(jti);
  if (!willWriteVersion && prev && now - prev < LAST_SEEN_THROTTLE_MS) return;
  lastSeenWrites.set(jti, now);
  // Fire-and-forget — yazım hatası isteği düşürmez (best-effort, touchUser emsali).
  void prisma.session
    .updateMany({ where: { jti }, data: { lastSeenAt: new Date(now) } })
    .catch(() => undefined);
  if (willWriteVersion) {
    versionWrites.add(jti);
    // ⚠️ YALNIZ NULL'DAN DOLUYA, TEK İFADEDE. `clientVersion: null` koşulu
    // sözleşmenin kendisidir: bir oturum TEK istemciye aittir, dolu bir satır
    // ikinci (farklı) bir sürümle DEĞİŞMEZ — yoksa uydurulabilir bir başlık,
    // kaldırma fazı kapısının gördüğü değeri istediği an değiştirebilirdi.
    // `revokedAt: null`: sonlanmış oturuma yazılmaz.
    void prisma.session
      .updateMany({
        where: { jti, clientVersion: null, revokedAt: null },
        data: { clientVersion },
      })
      .catch(() => undefined);
  }
  // Sınırsız büyümeyi önle: bayat girişleri ara sıra buda.
  if (lastSeenWrites.size > 5000) {
    const cutoff = now - LAST_SEEN_THROTTLE_MS;
    for (const [k, t] of lastSeenWrites) {
      if (t < cutoff) {
        lastSeenWrites.delete(k);
        versionWrites.delete(k);
      }
    }
  }
}

/**
 * YALNIZ BEKÇİ — bellek-içi dokunuş önbelleklerini sıfırla (emsal:
 * `resetClientRegistryForTest`). Olmadan, `clientVersion` yazımının DB
 * koşulunu (`clientVersion: null`) ölçmek İMKÂNSIZDI: `versionWrites` ikinci
 * denemeyi zaten süreç içinde kesiyor ve koşul kaldırılsa bile bekçi yeşil
 * kalıyordu (ölçüldü 2026-09-17, sonda tutmadı). ⇒ *İki sed varsa, birini
 * kaldırınca kırmızı veremeyen bir bekçi ikisini de ölçmüyordur.*
 */
export function resetSessionTouchCacheForTest(): void {
  lastSeenWrites.clear();
  versionWrites.clear();
}

/**
 * Kimlik bilgisi: `Authorization: Bearer` (RFC 6750 §2.1, şema büyük/küçük harf duyarsız); başlık
 * YOKSA bulut web panelinin `tekserp_oturum` çerezi (başlık varsa çerez HİÇ okunmaz). Çerez tarayıcıca
 * kendiliğinden gider → durum değiştiren çerezli istek aynı-origin JS'in koyabildiği başlığı taşımalı (CSRF).
 */
function readCredential(req: Request): { token: string; viaCookie: boolean } | AppError {
  const credential = readRequestToken(req);
  if (!credential) return AppError.unauthorized("Token bulunamadı. Authorization header gerekli.");
  const viaCookie = credential.via === "cookie";
  if (viaCookie && !isSafeMethod(req.method) && !hasCsrfHeader(req)) {
    return AppError.forbidden("Güvenlik başlığı eksik. Sayfayı yenileyip tekrar deneyin.", { code: "CSRF_REQUIRED" });
  }
  return { token: credential.token, viaCookie };
}

/**
 * Middleware: Verify JWT token from Authorization header.
 * Sets `req.user` with decoded JwtPayload on success.
 *
 * İmza/expiry doğrulamasının ardından ANINDA-İPTAL kontrolü:
 *  1. User.tokenVersion + isActive taze okunur (yetki/şifre değişince bump → 401);
 *     yetki kümesi ve kullanıcı adı da DB'den (token claim'i karar kaynağı değil).
 *  2. Session (jti) taze okunur; kayıt yoksa, revokedAt set ya da expiresAt geçmişse → 401 (oturum
 *     iptal edildi / logout / başka cihazdan kick). Fail-closed: jti'siz eski token
 *     (deploy öncesi üretilmiş) da 401 alır → bir kez re-login (kabul edilen davranış).
 */
async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
  allowPasswordChangePending: boolean,
): Promise<void> {
  const credential = readCredential(req);
  if (credential instanceof AppError) return next(credential);
  const { token, viaCookie } = credential;

  try {
    const payload = AuthService.verifyToken(token);
    const freshRow = await prisma.user.findUnique({
      where: { id: payload.userId },
      // ⚠️ `isSystemAccount` BİLEREK burada okunur (JWT claim'i değil): istek
      // başına ZATEN yapılan bir okuma, yani maliyet sıfır; değer DB-taze; ve
      // guard'lar senkron kalabilir (bkz. types/express-augment.ts).
      // Mühür kolonları da: sistem hesabının yetkisi bayrak + geçerli mühürdür (G1).
      // TOTP ilişkileri (mühür özeti) yalnız sistem hesabında ikinci okumayla gelir.
      select: {
        ...SEAL_SCALAR_SELECT,
        tokenVersion: true,
        isActive: true,
        mustChangePassword: true,
      },
    });
    const fresh = freshRow ? await completeSealRow(freshRow) : null;
    if (!fresh || !fresh.isActive) {
      throw AppError.unauthorized("Hesap pasif veya bulunamadı. Tekrar giriş yapın.");
    }
    if (fresh.tokenVersion !== payload.tokenVersion) {
      throw AppError.unauthorized("Oturum geçersiz kılındı (yetki/şifre değişti). Tekrar giriş yapın.");
    }
    // Session registry: anlık iptal kontrolü (jti). Eski (jti'siz) token → fail-closed.
    if (!payload.jti) {
      throw AppError.unauthorized("Oturum kaydı yok (eski token). Tekrar giriş yapın.");
    }
    const session = await prisma.session.findUnique({
      where: { jti: payload.jti },
      // ⚠️ `userId` DE OKUNUR (2026-09-03 / P3 düzeltme turu — D2 NOT'u):
      // savunma derinliği. Eskiden yalnız "bu jti canlı mı" soruluyordu, "bu
      // jti BU KULLANICIYA mı ait" sorulmuyordu — yani JWT_SECRET'ı ele geçiren
      // biri, başka bir oturumun geçerli jti'sini alıp payload'a İSTEDİĞİ
      // userId'yi (örn. satıcı hesabını) yazabiliyordu. ÖLÇÜLDÜ: admin'in
      // jti'si + `bakim` userId/tokenVersion ile imzalanan token `/auth/me`den
      // 200 `isSystemAccount:true` aldı. Ön koşul sunucu sırrının sızması, yani
      // zaten ağır bir olay; ama `Session.userId` kolonu ELDEYKEN kontrol
      // etmemek bedava bir katmanı boşa bırakmaktı. Ek maliyet: sıfır (aynı
      // sorguda bir kolon).
      select: { revokedAt: true, revokeReason: true, userId: true, expiresAt: true, deviceType: true },
    });
    if (!session) {
      throw AppError.unauthorized("Oturum kaydı bulunamadı. Tekrar giriş yapın.", {
        code: "SESSION_INVALID",
      });
    }
    // Çerez yalnız WEB oturumunu taşır: Electron/tablet token'ı çereze konsa da kabul edilmez (aynı kod/ileti).
    if (session.userId !== payload.userId || (viaCookie && session.deviceType !== ClientType.WEB)) {
      // Aynı kod + aynı mesaj: "hangi oturum kimin" bilgisini dışarı SIZDIRMAZ
      // (ayrı bir kod/mesaj, saldırgana jti'nin geçerli ama sahibinin farklı
      // olduğunu söyleyen bir orakül olurdu).
      throw AppError.unauthorized("Oturum kaydı bulunamadı. Tekrar giriş yapın.", {
        code: "SESSION_INVALID",
      });
    }
    if (session.revokedAt !== null) {
      // Sebebe göre NET mesaj — client "süresi doldu" gibi yanlış bildirim vermesin.
      const reason = session.revokeReason ?? "";
      const msg = SESSION_REVOKE_MESSAGES[reason] ?? "Oturumunuz sonlandırıldı. Tekrar giriş yapın.";
      throw AppError.unauthorized(msg, { code: "SESSION_REVOKED", reason });
    }
    // Oturum bitişi SUNUCUDA (denetim §B3e): JWT `exp`i sızan sırla uzatılabilir ya da
    // hiç olmayabilir (eski token); karar DB'deki `expiresAt`tedir. İleti JWT süre dolumuyla aynı.
    if (session.expiresAt.getTime() <= Date.now()) {
      throw AppError.unauthorized("Geçersiz veya süresi dolmuş token");
    }
    // Zorunlu parola değişimi bekleyen hesap yalnız beyanlı uçlara geçer (oturum denetimlerinden
    // SONRA: iptal edilmiş oturum önce 401 alır).
    if (fresh.mustChangePassword && !allowPasswordChangePending) {
      throw AppError.forbidden(PASSWORD_CHANGE_REQUIRED_MESSAGE, { code: PASSWORD_CHANGE_REQUIRED_CODE });
    }
    // Yetki ve kimlik adı DB'den: token'daki `permissions`/`username` claim'leri karar
    // kaynağı değildir (sızan sırla yeniden imzalanmış token yetki kazanmasın).
    const systemAccount = isSystemAccountAuthorized(fresh);
    if (isSealRejected(fresh)) void reportInvalidSeal(fresh);
    const permissions = await AuthService.resolveRequestPermissions(payload.userId, fresh.tokenVersion, systemAccount);
    if (payload.exp === undefined && !warnedExpLessJtis.has(payload.jti)) {
      if (warnedExpLessJtis.size > 5000) warnedExpLessJtis.clear();
      warnedExpLessJtis.add(payload.jti);
      uyari(
        "oturum",
        `Süresiz (exp'siz) eski token kabul edildi — kullanıcı ${fresh.username}; bir sonraki girişte süreli token alır.`,
      );
    }
    req.user = { ...payload, username: fresh.username, permissions };
    req.isSystemAccount = systemAccount;
    req.mustChangePassword = fresh.mustChangePassword === true;
    touchUser(payload.userId); // anlık "online" izleme (bellekte, maliyetsiz)
    // ⚠️ Sürüm de burada YAZILIR, yalnız login'de değil: panel künye sürümünü main
    // process'ten ASENKRON okuyor ve İLK istek (login) sürümsüz gidebiliyor
    // (01 ölçtü 2026-09-17) — login'e bağlı kalsaydı panel oturumları çoğu kez
    // NULL kalır, kaldırma fazı kapısı kalıcı "ÖLÇÜLEMEDİ" görürdü.
    touchSessionLastSeen(payload.jti, readClientVersionHeader(req.headers));
    next();
  } catch (error) {
    // Ölü çerez tarayıcıda kalmasın (başlık henüz gönderilmediyse).
    if (viaCookie && error instanceof AppError && error.statusCode === 401 && !res.headersSent) clearSessionCookie(res);
    next(error);
  }
}

/** Kimliği doğrulanmış her uç; zorunlu parola değişimi bekleyen hesaba 403 PASSWORD_CHANGE_REQUIRED. */
export const verifyToken = (req: Request, res: Response, next: NextFunction): Promise<void> =>
  authenticate(req, res, next, false);

/**
 * Parola değişimi bekleyen hesabın da geçebildiği kapı — YALNIZ /auth/me, /auth/logout,
 * /auth/change-password. Kullanım yeri `test_parola_degisimi_zorunlu` ile sayılır.
 */
export const verifyTokenAllowPasswordChange = (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => authenticate(req, res, next, true);
