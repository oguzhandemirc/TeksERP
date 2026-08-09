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
 * ⚠️ DOMAIN = İLK iki noktaya kadarki ön ek — ve bu, çok kolonlu kodları DA kapsar.
 * (2026-08-09 denetimi, F-CORE-GUV-004: buradaki eski açıklama kodun TERSİNİ
 * söylüyordu — "mobile:* iki kolonlu mobile:depo:read'i KAPSAMAZ" diyordu.)
 * Gerçek davranış: `indexOf(":")` İLK iki noktayı bulur, yani required
 * "mobile:depo:read" için üretilen wildcard "mobile:*"tır ve EŞLEŞİR.
 *
 * Yanlış açıklamanın tehlikesi somuttu: birisi `mobile:depo:write` gibi iki
 * kolonlu bir kod ekleyip "mobile:* bunu vermez, ayrıca atamam gerekir" diye
 * varsayardı; kod ise `mobile:*` taşıyan HERKESE o yetkiyi sessizce verirdi —
 * ve bu, kullanıcının atanmış izin listesinde GÖRÜNMEZDİ.
 *
 * Bugün katalogdaki 67 kodun tamamı TEK kolonludur (mekanik olarak doğrulanıyor:
 * `scripts/test_permission_catalog.ts` her kodun tam bir iki nokta taşıdığını
 * iddia eder). Yani bu bir gelecek tuzağıdır, bugünkü bir açık değil — ve
 * kolon-sayısı kontrolü tam olarak o tuzağın kapısıdır.
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
