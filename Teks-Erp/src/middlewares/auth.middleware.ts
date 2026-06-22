// =============================================================================
// TeksERP - JWT Authentication Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { AppError } from "../utils/app-error";
import { touchUser } from "../lib/presence";
import prisma from "../lib/prisma";

/**
 * Middleware: Verify JWT token from Authorization header.
 * Sets `req.user` with decoded JwtPayload on success.
 *
 * İmza/expiry doğrulamasının ardından ANINDA-İPTAL kontrolü: User.tokenVersion +
 * isActive taze okunur (tek indeksli PK lookup). Yetki/şifre değişince tokenVersion
 * bump'lanır → eski token bu noktada 401 alır; pasifleştirilen kullanıcı da anında
 * düşer. (Eskiden tamamen stateless'tı; iptal token expiry'sine kadar gecikiyordu.)
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
      select: { tokenVersion: true, isActive: true },
    });
    if (!fresh || !fresh.isActive) {
      throw AppError.unauthorized("Hesap pasif veya bulunamadı. Tekrar giriş yapın.");
    }
    if (fresh.tokenVersion !== payload.tokenVersion) {
      throw AppError.unauthorized("Oturum geçersiz kılındı (yetki/şifre değişti). Tekrar giriş yapın.");
    }
    req.user = payload;
    touchUser(payload.userId); // anlık "online" izleme (bellekte, maliyetsiz)
    next();
  } catch (error) {
    next(error);
  }
};
