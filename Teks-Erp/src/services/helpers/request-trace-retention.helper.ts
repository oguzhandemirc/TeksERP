// =============================================================================
// İstek başlığının (`request_traces`) saklama süresi — SAF (izlenebilirlik B1, K-B1)
// =============================================================================
// Telemetri (defter.md § Telemetri ≠ defter): satır silinince raporlanan hiçbir sayı değişmez.
// Süre GÜN cinsinden; 0 = budama yok.
// =============================================================================

export const DEFAULT_REQUEST_TRACE_RETENTION_DAYS = 90;
export const MAX_REQUEST_TRACE_RETENTION_DAYS = 3650;

/** Geçerli ayar değeri mi (0 dahil — "budama yok"). */
export function isValidRequestTraceRetentionDays(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_REQUEST_TRACE_RETENTION_DAYS;
}

/** `days` günden eski satırların kesim anı; 0 ya da geçersiz → budama yok (null). */
export function requestTracePurgeCutoff(days: number, now: Date): Date | null {
  if (!isValidRequestTraceRetentionDays(days) || days === 0) return null;
  return new Date(now.getTime() - days * 86_400_000);
}
