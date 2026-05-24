// =============================================================================
// UUID path-param doğrulayıcı (helper — middleware DEĞİL)
// =============================================================================
// Not: Bu dosya başta Express middleware olarak yazıldı, ancak `app.use(path,
// mw)` pattern'i path placeholder'larını ayırt edemediği için literal action
// segment'leri (`/api/auth/me`, `/api/rolls/barcode/<x>`, vb.) yanlışlıkla
// UUID kontrolüne sokuldu. Bu nedenle middleware kaldırıldı; yerine
// `assertValidUuid()` saf-fonksiyonu kaldı — `BaseController` `findById`/
// `update`/`remove` gibi gerçekten ID lookup yapan handler'ların başında
// çağrılıyor (`controllers/base.controller.ts` → `getParamId()`).
// =============================================================================

import { AppError } from "../utils/app-error";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Geçersizse `AppError.badRequest` fırlatır; geçerliyse string'i döner. */
export function assertValidUuid(value: unknown, paramName = "id"): string {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    throw AppError.badRequest(
      `Geçersiz UUID formatı: '${paramName}' parametresi ('${String(value)}')`
    );
  }
  return value;
}
