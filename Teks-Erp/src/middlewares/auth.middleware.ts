// =============================================================================
// TeksERP - JWT Authentication Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { AppError } from "../utils/app-error";
import { readClientVersionHeader } from "../constants/client-info";
import { touchUser } from "../lib/presence";
import prisma from "../lib/prisma";

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

/** Session.revokeReason → operatöre gösterilecek NET Türkçe mesaj. Yanlış
 *  "oturum süresi doldu" bildirimini önler (asıl sebep: kick / şifre / pasif). */
const SESSION_REVOKE_MESSAGES: Record<string, string> = {
  NEW_LOGIN: "Bu hesapla başka bir cihazdan giriş yapıldığı için buradaki oturum kapatıldı.",
  PASSWORD_RESET: "Şifreniz değiştiği için oturumunuz kapatıldı. Tekrar giriş yapın.",
  DEACTIVATED: "Hesabınız pasife alındığı için oturumunuz kapatıldı.",
  DELETED: "Hesabınız kaldırıldığı için oturumunuz kapatıldı.",
  LOGOUT: "Oturumunuz kapatıldı. Tekrar giriş yapın.",
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
 * Middleware: Verify JWT token from Authorization header.
 * Sets `req.user` with decoded JwtPayload on success.
 *
 * İmza/expiry doğrulamasının ardından ANINDA-İPTAL kontrolü:
 *  1. User.tokenVersion + isActive taze okunur (yetki/şifre değişince bump → 401).
 *  2. Session (jti) taze okunur; kayıt yoksa veya revokedAt set ise → 401 (oturum
 *     iptal edildi / logout / başka cihazdan kick). Fail-closed: jti'siz eski token
 *     (deploy öncesi üretilmiş) da 401 alır → bir kez re-login (kabul edilen davranış).
 */
export const verifyToken = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  // RFC 6750 §2.1: scheme adı case-insensitive ("Bearer" = "bearer" = "BEARER").
  // Header: `<scheme> <token>` — scheme'i case-insensitive doğrula, sonra
  // boşluktan sonraki token'ı al.
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return next(AppError.unauthorized("Token bulunamadı. Authorization header gerekli."));
  }

  const token = match[1].trim();

  try {
    const payload = AuthService.verifyToken(token);
    const fresh = await prisma.user.findUnique({
      where: { id: payload.userId },
      // ⚠️ `isSystemAccount` BİLEREK burada okunur (JWT claim'i değil): istek
      // başına ZATEN yapılan bir okuma, yani maliyet sıfır; değer DB-taze; ve
      // guard'lar senkron kalabilir (bkz. types/express-augment.ts).
      select: { tokenVersion: true, isActive: true, isSystemAccount: true },
    });
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
      select: { revokedAt: true, revokeReason: true, userId: true },
    });
    if (!session) {
      throw AppError.unauthorized("Oturum kaydı bulunamadı. Tekrar giriş yapın.", {
        code: "SESSION_INVALID",
      });
    }
    if (session.userId !== payload.userId) {
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
    req.user = payload;
    req.isSystemAccount = fresh.isSystemAccount === true;
    touchUser(payload.userId); // anlık "online" izleme (bellekte, maliyetsiz)
    // ⚠️ Sürüm de burada YAZILIR, yalnız login'de değil: panel künye sürümünü main
    // process'ten ASENKRON okuyor ve İLK istek (login) sürümsüz gidebiliyor
    // (01 ölçtü 2026-09-17) — login'e bağlı kalsaydı panel oturumları çoğu kez
    // NULL kalır, kaldırma fazı kapısı kalıcı "ÖLÇÜLEMEDİ" görürdü.
    touchSessionLastSeen(payload.jti, readClientVersionHeader(req.headers));
    next();
  } catch (error) {
    next(error);
  }
};
