// =============================================================================
// TeksERP - RBAC (Role-Based Access Control) Middleware
// =============================================================================
// Usage in routes:
//   router.get("/orders", verifyToken, requirePermission("order:read"), controller.findAll);
//   router.post("/orders", verifyToken, requirePermission("order:write"), controller.create);
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error";

/**
 * Middleware factory: Check if the authenticated user has the required permission.
 * Must be used AFTER `verifyToken` middleware.
 */
export const requirePermission = (requiredPermission: string) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(AppError.unauthorized("Kimlik doğrulama gerekli."));
    }

    const hasPermission = req.user.permissions.includes(requiredPermission);

    if (!hasPermission) {
      return next(
        AppError.forbidden(
          `Bu işlem için '${requiredPermission}' yetkisi gerekli.`
        )
      );
    }

    next();
  };
};

/**
 * Middleware factory: Check if the user has ANY of the given permissions.
 */
export const requireAnyPermission = (...requiredPermissions: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(AppError.unauthorized("Kimlik doğrulama gerekli."));
    }

    const hasAny = requiredPermissions.some((p) =>
      req.user!.permissions.includes(p)
    );

    if (!hasAny) {
      return next(
        AppError.forbidden(
          `Bu işlem için şu yetkilerden birine ihtiyacınız var: ${requiredPermissions.join(", ")}`
        )
      );
    }

    next();
  };
};
