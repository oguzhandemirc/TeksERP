-- =============================================================================
-- SystemLog filtre + sıralama composite index'leri.
-- =============================================================================
-- Mevcut tekli index'ler (`userId`, `createdAt`) Modül/Kullanıcı filtreleri ile
-- birleştiğinde sort için ek iş yaratıyordu. Composite (filter, createdAt DESC)
-- sayesinde planner tek index scan ile filtreli sayfalı listeyi getirir.
--
-- Canlıda milyon-satır system_logs için CONCURRENTLY zorunlu — yazma kilidi
-- alınmazsa log yazımı dakikalarca bloklanır. Çalıştırma:
--   npm run migrate:concurrent 20260523190000_system_log_filter_indexes
-- =============================================================================

-- Modül filtresi + tarih sıralaması: planner tek index scan + ORDER BY için ek sort yok
CREATE INDEX CONCURRENTLY IF NOT EXISTS "system_logs_tableName_createdAt_idx"
  ON "system_logs" ("tableName", "createdAt" DESC);

-- Kullanıcı filtresi + tarih sıralaması: yukarıdakinin userId analogu
CREATE INDEX CONCURRENTLY IF NOT EXISTS "system_logs_userId_createdAt_idx"
  ON "system_logs" ("userId", "createdAt" DESC);
