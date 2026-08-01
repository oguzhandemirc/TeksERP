-- =============================================================================
-- Audit özeti "daily" sorgusu — İFADE İSTATİSTİĞİNİ FABRİKA SAAT DİLİMİNE TAŞI
-- =============================================================================
-- BAĞLAM: 20260614120000_system_log_daily_stats, getSystemLogSummary'nin günlük
-- serisi için `sl_day_exact` ifade istatistiğini kurmuştu. O istatistik BİREBİR
-- şu ifadeye bağlıydı:
--     DATE_TRUNC('day', "createdAt")::date
--
-- NE DEĞİŞTİ: 20260801040000_timestamptz_conversion ile "createdAt" timestamptz
-- oldu. timestamptz'de DATE_TRUNC OTURUM saat diliminde keser; havuz oturumu
-- UTC olduğu için (src/lib/pg-session.ts) günler UTC'de kesiliyordu. Fabrika
-- Europe/Istanbul'da ve vardiya gece yarısını geçiyor → gece 00:00-03:00
-- arasındaki her audit kaydı BİR ÖNCEKİ günün çubuğuna düşüyordu. Servis artık
-- günü açıkça fabrika saat diliminde kesiyor (src/constants/time.ts):
--     DATE_TRUNC('day', "createdAt" AT TIME ZONE 'Europe/Istanbul')::date
--
-- NEDEN BU MIGRATION ŞART: ifade istatistiği METİN olarak eşleşir. Servis ifadesi
-- değişince eski istatistik SESSİZCE devre dışı kalır — sonuç DOĞRU kalır ama
-- planner grup sayısını yeniden ~satır sayısı sanıp diske taşan tek-thread
-- Sort+GroupAggregate planına döner (ölçüm: daily 113ms -> 258ms; audit özeti
-- toplamı ~2.14x yavaşlama, 430k satır / 365 gün worst-case).
--
-- Bu bir DDL değişikliği değil, yalnız katalog + ANALYZE: yazma yoluna sıfır
-- maliyet, tabloya kilit yok (CREATE STATISTICS anlıktır).
--
-- ⚠️ İfade `src/constants/time.ts` -> factoryDaySql'in ürettiği metinle BİREBİR
--    aynı olmalı. Orada saat dilimi sabiti (FACTORY_TIMEZONE) değişirse burası
--    da yeni bir migration ile güncellenmeli.

SET statement_timeout = 0;

DROP STATISTICS IF EXISTS sl_day_exact;

CREATE STATISTICS sl_day_exact
  ON ((DATE_TRUNC('day', "createdAt" AT TIME ZONE 'Europe/Istanbul')::date))
  FROM system_logs;

-- İstatistiği hemen doldur ki ilk audit raporu da hızlı planı alsın
-- (yoksa bir sonraki autovacuum ANALYZE'a kadar plan tahmini boş kalır).
ANALYZE system_logs;
