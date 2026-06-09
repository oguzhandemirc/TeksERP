// =============================================================================
// TeksERP - JWT Authentication Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { AppError } from "../utils/app-error";
import { touchUser } from "../lib/presence";

/**
 * Middleware: Verify JWT token from Authorization header.
 * Sets `req.user` with decoded JwtPayload on success.
 */
export const verifyToken = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
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
    req.user = AuthService.verifyToken(token);
    touchUser(req.user.userId); // anlık "online" izleme (bellekte, maliyetsiz)
    next();
  } catch (error) {
    next(error);
  }
};
