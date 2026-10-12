-- Perf-1 B1/B2 indeksleri. CONCURRENTLY yok: Prisma migration'ı tek tx'te koşar.
-- CREATE INDEX tablo yazmalarını yapım süresince bekletir (300k satırda ~0,2 sn ölçüldü);
-- büyük kurulumda vardiya dışında deploy edilir (deploy-kurulum.md).
SET statement_timeout = 0;

-- Salon canlı duruş penceresi: seçici yüklem endedAt; iptal edilmiş duruş pencereye girmez.
CREATE INDEX IF NOT EXISTS "machine_stop_events_open_window_idx" ON "machine_stop_events"("endedAt") WHERE "revokedAt" IS NULL;

-- Salon çalışma penceresi (aynı yüklem, tezgah başına).
CREATE INDEX IF NOT EXISTS "machine_runs_machineId_endedAt_idx" ON "machine_runs"("machineId", "endedAt");

-- Depo hareket defteri varsayılan sırası (createdAt desc, id desc).
CREATE INDEX IF NOT EXISTS "warehouse_movements_createdAt_id_idx" ON "warehouse_movements"("createdAt" DESC, "id" DESC);
