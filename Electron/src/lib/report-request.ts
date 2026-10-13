// =============================================================================
// RAPOR İSTEĞİ — zaman aşımı ve uyarı basımı (Perf-2 B5, 2026-10-13)
// =============================================================================
// Ağır rapor (dokuma karnesi, uzun aralık) genel 15 sn'yi aşabilir; sunucu sorguyu yine
// bitirir, sonuç çöpe gider, kullanıcı yeniden tıklar. `/api/reports/*` 60 sn bekler.
// Satır tavanı uyarısı (`warnings`) GET yanıtında gelir; rapor GET'i genel basıma girer.

/** apiClient'ın genel zaman aşımı — rapor dışı her istek. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Rapor uçlarının zaman aşımı. */
export const REPORT_TIMEOUT_MS = 60_000;

/** `/api/reports/…` (mutlak adres de olabilir; sorgu dizgisi önemsiz). */
export function isReportUrl(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "");
  return path.startsWith("/api/reports/");
}

/** Rapor isteği genel varsayılanı taşıyorsa 60 sn; isteğin açık zaman aşımı (≠ varsayılan) korunur. */
export function resolveRequestTimeout(url: string | undefined, timeout: number | undefined): number | undefined {
  if (isReportUrl(url) && (timeout === undefined || timeout === DEFAULT_TIMEOUT_MS)) return REPORT_TIMEOUT_MS;
  return timeout;
}
