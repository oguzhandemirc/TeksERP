// =============================================================================
// TeksERP - RBAC (Permission Check) Middleware
// =============================================================================
// Usage in routes:
//   router.get("/orders", verifyToken, requirePermission("order:read"), controller.findAll);
//   router.post("/orders", verifyToken, requirePermission("order:write"), controller.create);
//
// Wildcard: "admin:*" verilen kullanıcı tüm "admin:..." izinlerini sağlar.
// "*" tüm izinleri sağlar (süper admin için tek-tek liste yerine).
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error";

/**
 * Kullanıcı izinleri arasında required iznin karşılanıp karşılanmadığını kontrol eder.
 * Domain-bazlı wildcard ("mobile:*") ve global wildcard ("*") destekler.
 *
 * Domain wildcard yalnızca tek seviyelidir: "admin:*" → "admin:users", "admin:settings"
 * eşleşir ama hierarchical değildir (yani "mobile:*" → "mobile:depo:read" gibi
 * iki kolonlu kodları kapsamaz; öyle bir konvansiyon kullanılmıyor).
 */
export const matchesPermission = (
  userPermissions: readonly string[],
  required: string
): boolean => {
  if (userPermissions.includes("*")) return true;
  if (userPermissions.includes(required)) return true;
  const colon = required.indexOf(":");
  if (colon > 0) {
    const domainWildcard = `${required.slice(0, colon)}:*`;
    if (userPermissions.includes(domainWildcard)) return true;
  }
  return false;
};

/**
 * Middleware factory: Check if the authenticated user has the required permission.
 * Must be used AFTER `verifyToken` middleware.
 */
export const requirePermission = (requiredPermission: string) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(AppError.unauthorized("Kimlik doğrulama gerekli."));
    }

    if (!matchesPermission(req.user.permissions, requiredPermission)) {
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
      matchesPermission(req.user!.permissions, p)
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
