// =============================================================================
// YEDEK PAROLASI — şifreli yedeği (`.tkenc`) sunucuda açan parola
// =============================================================================
// Backend: `restore-impact` ve `db-copies` şifreli yedekte `X-Backup-Password`
// başlığı ister (yalnız başlık — gövde/query loga düşer). Sözleşme ayar şifresiyle
// aynı: istek önce parolasız gider, 403 REQUIRED/INVALID'de sorulur, 429 LOCKED'da
// döngü biter.
//
// ⚠️ PAROLA HATIRLANMAZ ve HİÇBİR YERE YAZILMAZ: yalnız o eylemin bileşen
// durumunda/ref'inde yaşar, istek gidince silinir; log/toast/localStorage YOK.
// =============================================================================

import axios from "axios";

export const BACKUP_PASSWORD_HEADER = "X-Backup-Password";

export const BACKUP_PASSWORD_CODES = {
  REQUIRED: "BACKUP_PASSWORD_REQUIRED",
  INVALID: "BACKUP_PASSWORD_INVALID",
  LOCKED: "BACKUP_PASSWORD_LOCKED",
} as const;

export type BackupPasswordCode = (typeof BACKUP_PASSWORD_CODES)[keyof typeof BACKUP_PASSWORD_CODES];

/** Yanıttaki `details.code` bir yedek parolası kodu mu? */
export function backupPasswordErrorCode(error: unknown): BackupPasswordCode | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return typeof code === "string" && code.startsWith("BACKUP_PASSWORD_") ? (code as BackupPasswordCode) : null;
}

/** Sunucunun kendi cümlesi (kilit süresi orada yazar) — yoksa yedek. */
export function backupPasswordMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const m = (error.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

/** Parola verilmişse başlığı, yoksa boş nesneyi döner. */
export function backupPasswordHeaders(password: string | null | undefined): Record<string, string> {
  return password ? { [BACKUP_PASSWORD_HEADER]: password } : {};
}
