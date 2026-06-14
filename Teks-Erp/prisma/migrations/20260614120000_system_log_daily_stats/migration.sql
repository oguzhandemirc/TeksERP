-- =============================================================================
-- Faz C2 — Audit özeti (getSystemLogSummary) "daily" sorgusu için ifade istatistiği
-- =============================================================================
-- getSystemLogSummary'nin günlük seri sorgusu:
--     GROUP BY DATE_TRUNC('day', "createdAt")::date
-- yapar. Bu IFADE'nin distinct-değer sayısı hakkında istatistik OLMADAN planner,
-- her satırı ayrı grup sanar (rows ≈ tablo satır sayısı) → HashAggregate'i "çok
-- büyük" zannedip diske-taşan, TEK-THREAD Sort + GroupAggregate planını seçer.
--
-- Tam-eşleşen ifade istatistiğiyle planner gerçek kardinaliteyi (~aralıktaki gün
-- sayısı, ≤366) bilir → byAction sorgusuyla aynı PARALEL in-memory HashAggregate
-- planına geçer.
--
-- ÖLÇÜLDÜ (SCALE-REPORT.md §8, 430k satır / 365-gün worst-case, PG17):
--   daily tek-sorgu  EXPLAIN exec : 258ms → 113ms  (~2.3×, Sort+disk → paralel hashagg)
--   tüm audit özeti  p50/min      : 1064/654ms → 498/330ms  (stats katkısı 2.14×/1.98×)
--
-- MALİYET: Yazma yoluna SIFIR — ifade istatistiği yalnız ANALYZE/autovacuum'da
-- güncellenir, her INSERT'te DEĞİL (index'in aksine; en hızlı büyüyen tabloya
-- index eklemekten kaçınma kuralıyla uyumlu). Drift: Prisma 7 extended statistics
-- nesnesini modellemez → schema.prisma dokunulmaz, partial-index deseniyle aynı.
--
-- ⚠️ İfade BİREBİR servisteki ile eşleşmeli (DATE_TRUNC('day',"createdAt")::date);
--    cast/whitespace farkı ifade ağacını bozmasa da, kolon/cast değişirse stats
--    devre dışı kalır (sessizce eski yavaş plana düşer — yanlış sonuç ÜRETMEZ).

-- ANALYZE büyük tabloda statement_timeout'a takılmasın (örnekleme hızlıdır ama
-- garanti). CREATE STATISTICS anlıktır (sadece katalog).
SET statement_timeout = 0;

CREATE STATISTICS IF NOT EXISTS sl_day_exact
  ON ((DATE_TRUNC('day', "createdAt")::date))
  FROM system_logs;

-- İstatistiği hemen doldur ki ilk audit raporu da hızlı planı alsın
-- (yoksa bir sonraki autovacuum ANALYZE'a kadar eski plan sürer).
ANALYZE system_logs;
