// =============================================================================
// TeksERP - JWT Authentication Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { AppError } from "../utils/app-error";

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

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(AppError.unauthorized("Token bulunamadı. Authorization header gerekli."));
  }

  const token = authHeader.split(" ")[1];

  try {
    req.user = AuthService.verifyToken(token);
    next();
  } catch (error) {
    next(error);
  }
};
