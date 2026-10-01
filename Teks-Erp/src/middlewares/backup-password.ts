// =============================================================================
// YEDEK PAROLASI — şifreli yedeği sunucuda açan tek kapı (geri yükleme önizlemesi · kopya)
// =============================================================================
// Yerel anahtarın özel yarısı `BACKUP_KEY_DIR/yerel.tkkey`te YEDEK PAROLASIYLA sarılı
// durur; parola yalnız bu eylemde, yalnız `X-Backup-Password` başlığından gelir.
// Gövde/query/cookie OKUNMAZ: query erişim loguna ve audit yoluna düz metin düşer
// (ayar şifresi kapısının ölçülmüş sızıntısı, aynı gerekçe). Parola loga/audite girmez.
//
// Ayar şifresi kapısından farkı: bu bir NİYET kapısı değil ANAHTARDIR — süperadmin de
// muaf değildir (parolasız açılamaz) ve "hash yok → uyur" dalı yoktur; dosya düz ise
// kapı hiç devreye girmez (bugünkü davranış).
//
// Kilit: giriş kilidinin mekanizması, AYRI kova (`bp:` öneki) — yanlış yedek parolası
// oturum açmayı kilitlememeli, tersi de.
// =============================================================================

import type { Request } from "express";
import type { KeyObject } from "crypto";
import { AppError } from "../utils/app-error";
import { AuditService } from "../services/audit.service";
import { isBackupCryptoError, isEncryptedBackup, readBackupCryptoConfig, unlockLocalKey } from "../lib/backup-crypto";
import { releaseLoginAttempt, reserveLoginAttempt, resolveLoginLockoutKeys, type LockoutKeySpec } from "./login-lockout";
import "../types/express-augment";

export const BACKUP_PASSWORD_HEADER = "x-backup-password";

export type BackupUnlock =
  | { encrypted: false }
  /** `identity: null` → sunucuda yerel anahtar yok; içerik burada açılamaz. */
  | { encrypted: true; identity: KeyObject | null };

function readHeaderPassword(req: Request): string | null {
  const raw = req.headers[BACKUP_PASSWORD_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function lockKeys(req: Request, userId: string | null): LockoutKeySpec[] {
  return resolveLoginLockoutKeys(req, `bp:${userId ?? "-"}`).map((spec) => ({ ...spec, key: `bp:${spec.key}` }));
}

/**
 * Yedek düzse `{encrypted:false}`. Şifreliyse başlıktaki parolayla yerel anahtarı açar.
 * 403 `BACKUP_PASSWORD_REQUIRED` (başlık yok) · 403 `BACKUP_PASSWORD_INVALID` · 429
 * `BACKUP_PASSWORD_LOCKED` fırlatır — panel önce parolasız dener, 403'te sorar.
 */
export async function unlockBackupForRequest(req: Request, abs: string): Promise<BackupUnlock> {
  if (!(await isEncryptedBackup(abs))) return { encrypted: false };
  return { encrypted: true, identity: await unlockLocalBackupKeyForRequest(req, "Bu yedek şifreli — yedek parolası gerekli.") };
}

/**
 * Dosyadan bağımsız: yerel yedek anahtarını başlıktaki parolayla açar (kısa kimlik anahtar
 * emanetini açmak gibi). Yerel anahtar yoksa `null`; hata kodları `unlockBackupForRequest`le aynı.
 */
export async function unlockLocalBackupKeyForRequest(
  req: Request,
  requiredMessage = "Yedek parolası gerekli.",
): Promise<KeyObject | null> {
  const cfg = await readBackupCryptoConfig();
  if (!cfg.localKeyPath) return null;

  const userId = req.user?.userId ?? null;
  const keys = lockKeys(req, userId);
  // Rezervasyon scrypt'ten ÖNCE: kilitliyken pahalı anahtar türetme koşmasın.
  const lock = await reserveLoginAttempt(keys);
  if (lock.blocked) {
    throw AppError.tooManyRequests(
      `Çok fazla hatalı yedek parolası denemesi. ${lock.retryAfterSec} saniye sonra tekrar deneyin.`,
      { code: "BACKUP_PASSWORD_LOCKED", retryAfterSec: lock.retryAfterSec },
    );
  }
  const supplied = readHeaderPassword(req);
  if (supplied === null) {
    releaseLoginAttempt(keys);
    throw AppError.forbidden(requiredMessage, { code: "BACKUP_PASSWORD_REQUIRED" });
  }
  try {
    const identity = await unlockLocalKey(cfg, supplied);
    releaseLoginAttempt(keys);
    return identity;
  } catch (e) {
    if (isBackupCryptoError(e) && e.code === "YANLIS_PAROLA") {
      void AuditService.logEvent({
        category: "SYSTEM",
        action: "BACKUP_PASSWORD_FAILED",
        userId,
        payload: { userId, path: `${req.baseUrl ?? ""}${req.path ?? ""}` || null },
      });
      throw AppError.forbidden("Yedek parolası hatalı.", { code: "BACKUP_PASSWORD_INVALID" });
    }
    releaseLoginAttempt(keys);
    throw e;
  }
}
