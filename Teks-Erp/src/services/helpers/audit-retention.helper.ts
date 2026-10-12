// =============================================================================
// Audit ARŞİVİNİN saklama süresi — SAF
// =============================================================================
// Audit ayak izidir, defter değil: arşiv satırı silindiğinde raporlanan hiçbir sayı
// değişmez (defter.md § Telemetri ≠ defter). Süre yıl cinsinden; 0 = budama yok.
// Yaş satırın OLAY anına (`createdAt`) bakar, arşive taşındığı ana değil.
// =============================================================================

export const DEFAULT_AUDIT_ARCHIVE_RETENTION_YEARS = 3;
export const MAX_AUDIT_ARCHIVE_RETENTION_YEARS = 50;

/** Geçerli ayar değeri mi (0 dahil — "budama yok"). */
export function isValidAuditArchiveRetentionYears(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_AUDIT_ARCHIVE_RETENTION_YEARS;
}

/** `years` yıldan eski arşiv satırlarının kesim anı; 0 ya da geçersiz → budama yok (null). */
export function auditArchivePurgeCutoff(years: number, now: Date): Date | null {
  if (!isValidAuditArchiveRetentionYears(years) || years === 0) return null;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
}

/** İlk budama süpürmesinin taban ayı; altındaki satırlar ilk dilimde (alt sınırsız) gider. */
export const AUDIT_PURGE_FLOOR = new Date("2020-01-01T00:00:00.000Z");

/**
 * Sonraki budama diliminin üst sınırı (`createdAt < sonuç`): filigrandan (yoksa tabandan)
 * bir ay ileri, kesimi aşmadan. Filigran kesime ulaştıysa `null` — bu gecelik iş bitti.
 * Dilim arşivi okumadan ilerler: filigranın gerisi önceki dilimlerde zaten silindi.
 */
export function nextAuditPurgeSliceEnd(watermark: Date | null, cutoff: Date): Date | null {
  const start = watermark && watermark.getTime() > AUDIT_PURGE_FLOOR.getTime() ? watermark : AUDIT_PURGE_FLOOR;
  if (start.getTime() >= cutoff.getTime()) return null;
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end.getTime() < cutoff.getTime() ? end : cutoff;
}
