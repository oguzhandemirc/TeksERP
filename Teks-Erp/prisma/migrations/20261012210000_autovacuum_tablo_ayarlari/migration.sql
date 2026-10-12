-- Perf-6 B2: yoğun güncellenen / büyüyen altı tabloda tablo başına autovacuum eşiği.
-- Varsayılan scale_factor 0.2 milyonluk tabloda vacuum'u yüz binlerce ölü satıra dek
-- erteler; 0.02 / 0.01 ile tetik ~%2 ölü satırda gelir. ADDITIVE: veri yazmaz, yalnız
-- pg_class.reloptions değişir (ALTER TABLE SET anlık, tabloyu yeniden yazmaz).
-- Geri alma (gerekirse, yeni migration ile): ALTER TABLE <t> RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
-- İdempotent: SET aynı değeri yeniden yazar.
ALTER TABLE "rolls" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "machine_stop_events" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "machine_runs" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "system_logs" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "system_log_archives" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "sessions" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
