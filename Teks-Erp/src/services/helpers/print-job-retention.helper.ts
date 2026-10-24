// =============================================================================
// Yazdırma geçmişinin saklama süresi — SAF (izlenebilirlik A1, K-A1)
// =============================================================================
// `print_jobs` telemetridir (defter.md § Telemetri ≠ defter): satır silinince raporlanan hiçbir
// sayı değişmez, iptal guard'ı `labelPrintedAt` okur. Süre GÜN cinsinden; 0 = budama yok.
// =============================================================================

export const DEFAULT_PRINT_LOG_RETENTION_DAYS = 180;
export const MAX_PRINT_LOG_RETENTION_DAYS = 3650;

/** Geçerli ayar değeri mi (0 dahil — "budama yok"). */
export function isValidPrintLogRetentionDays(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_PRINT_LOG_RETENTION_DAYS;
}

/** `days` günden eski satırların kesim anı; 0 ya da geçersiz → budama yok (null). */
export function printJobPurgeCutoff(days: number, now: Date): Date | null {
  if (!isValidPrintLogRetentionDays(days) || days === 0) return null;
  return new Date(now.getTime() - days * 86_400_000);
}
