// =============================================================================
// TeksERP - JWT Authentication Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { AppError } from "../utils/app-error";
import { touchUser } from "../lib/presence";
import prisma from "../lib/prisma";

/**
 * Session.lastSeenAt yazımını cihaz başına (jti) kısıtla — her istekte DB update
 * yerine en fazla LAST_SEEN_THROTTLE_MS'de bir. touchUser gibi fire-and-forget +
 * bellekte (tek-process invariant). Restart'ta sıfırlanır (kalıcı defter değil).
 */
const lastSeenWrites = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 60_000;

/** Session.revokeReason → operatöre gösterilecek NET Türkçe mesaj. Yanlış
 *  "oturum süresi doldu" bildirimini önler (asıl sebep: kick / şifre / pasif). */
const SESSION_REVOKE_MESSAGES: Record<string, string> = {
  NEW_LOGIN: "Bu hesapla başka bir cihazdan giriş yapıldığı için buradaki oturum kapatıldı.",
  PASSWORD_RESET: "Şifreniz değiştiği için oturumunuz kapatıldı. Tekrar giriş yapın.",
  DEACTIVATED: "Hesabınız pasife alındığı için oturumunuz kapatıldı.",
  DELETED: "Hesabınız kaldırıldığı için oturumunuz kapatıldı.",
  LOGOUT: "Oturumunuz kapatıldı. Tekrar giriş yapın.",
};

function touchSessionLastSeen(jti: string): void {
  const now = Date.now();
  const prev = lastSeenWrites.get(jti);
  if (prev && now - prev < LAST_SEEN_THROTTLE_MS) return;
  lastSeenWrites.set(jti, now);
  // Fire-and-forget — yazım hatası isteği düşürmez (best-effort, touchUser emsali).
  void prisma.session
    .updateMany({ where: { jti }, data: { lastSeenAt: new Date(now) } })
    .catch(() => undefined);
  // Sınırsız büyümeyi önle: bayat girişleri ara sıra buda.
  if (lastSeenWrites.size > 5000) {
    const cutoff = now - LAST_SEEN_THROTTLE_MS;
    for (const [k, t] of lastSeenWrites) if (t < cutoff) lastSeenWrites.delete(k);
  }
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
      select: { revokedAt: true, revokeReason: true },
    });
    if (!session) {
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
    touchSessionLastSeen(payload.jti); // Session.lastSeenAt throttled (fire-and-forget)
    next();
  } catch (error) {
    next(error);
  }
};
