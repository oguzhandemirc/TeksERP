-- =============================================================================
-- Fason (Subcontractor) liste sayfaları performans tahkimati
-- =============================================================================
-- Hedef: 5+ yıl ölçeğinde milyon satıra çıkacak liste sorgularının
-- ORDER BY + LIMIT/OFFSET'i index-only hızda kalmasını garanti et.
--
-- Eklenen indexler:
--   subcontractor_receipts:
--     [receivedAt]                       — filtreyi̇z liste (mobil/web default)
--     [workOrderId, receivedAt]          — WO-filtreli + tarih sıralı
--     [subcontractorId, receivedAt]      — Firma-filtreli + tarih sıralı
--   subcontractor_dispatches:
--     [workOrderId, dispatchedAt]        — WO-filtreli + tarih sıralı
--     [subcontractorId, dispatchedAt]    — Firma-filtreli + tarih sıralı
--
-- ÖNEMLİ — CONCURRENTLY:
--   CREATE INDEX CONCURRENTLY tabloyu YAZMAYA kapatmaz; canlı fabrikada
--   milyon satırlık tabloda bile mal kabul / sevk akışını kesmez.
--   Trade-off: transaction içinde çalışamaz → bu migration `prisma migrate dev/deploy`
--   ile DEĞİL, `prisma db execute --file` + `prisma migrate resolve --applied` ile
--   uygulanır. Her CREATE INDEX statement'ı kendi auto-commit'inde koşar.
--
-- IF NOT EXISTS — idempotent. Tekrar çalıştırılırsa hata vermez.
--
-- Hata durumu: CONCURRENTLY başarısız olursa Postgres INVALID index bırakır.
-- Bu durumda: DROP INDEX CONCURRENTLY <name>; sonra tekrar oluştur.
-- Mevcut indexleri kontrol: SELECT indexname FROM pg_indexes WHERE tablename = '...';
-- =============================================================================

-- subcontractor_receipts
CREATE INDEX CONCURRENTLY IF NOT EXISTS "subcontractor_receipts_receivedAt_idx"
  ON "subcontractor_receipts" ("receivedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "subcontractor_receipts_workOrderId_receivedAt_idx"
  ON "subcontractor_receipts" ("workOrderId", "receivedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "subcontractor_receipts_subcontractorId_receivedAt_idx"
  ON "subcontractor_receipts" ("subcontractorId", "receivedAt");

-- subcontractor_dispatches
CREATE INDEX CONCURRENTLY IF NOT EXISTS "subcontractor_dispatches_workOrderId_dispatchedAt_idx"
  ON "subcontractor_dispatches" ("workOrderId", "dispatchedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "subcontractor_dispatches_subcontractorId_dispatchedAt_idx"
  ON "subcontractor_dispatches" ("subcontractorId", "dispatchedAt");
