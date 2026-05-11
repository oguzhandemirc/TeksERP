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
-- IF NOT EXISTS — idempotent. Tekrar çalıştırılırsa hata vermez.
-- CONCURRENTLY KULLANILMADI: test datada bloklayıcı CREATE INDEX yeterince hızlı.
-- Production'da milyon satırlık tablo için CONCURRENTLY ekleyin (ayrı migration).
-- =============================================================================

-- subcontractor_receipts
CREATE INDEX IF NOT EXISTS "subcontractor_receipts_receivedAt_idx"
  ON "subcontractor_receipts" ("receivedAt");

CREATE INDEX IF NOT EXISTS "subcontractor_receipts_workOrderId_receivedAt_idx"
  ON "subcontractor_receipts" ("workOrderId", "receivedAt");

CREATE INDEX IF NOT EXISTS "subcontractor_receipts_subcontractorId_receivedAt_idx"
  ON "subcontractor_receipts" ("subcontractorId", "receivedAt");

-- subcontractor_dispatches
CREATE INDEX IF NOT EXISTS "subcontractor_dispatches_workOrderId_dispatchedAt_idx"
  ON "subcontractor_dispatches" ("workOrderId", "dispatchedAt");

CREATE INDEX IF NOT EXISTS "subcontractor_dispatches_subcontractorId_dispatchedAt_idx"
  ON "subcontractor_dispatches" ("subcontractorId", "dispatchedAt");
