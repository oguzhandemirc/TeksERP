-- =============================================================================
-- Rapor sorgularında tarih-aralığı filtreleri için indeksler.
-- Tüm yüksek-hacim tablolarda CONCURRENTLY (canlıda yazma kilidi yaratmaz).
-- Yeni kurulumlarda Prisma migration tek transaction çalıştırır → CONCURRENTLY
-- orada hata verir; bu durumda `scripts/migrate-concurrent.sh` kullanın
-- (CLAUDE.md "Database Performance Rules" bölümü).
-- =============================================================================

-- RollOperation: operatör/makine performans + Kurşun/QC2 oranı sorguları
CREATE INDEX CONCURRENTLY IF NOT EXISTS "roll_operations_createdAt_idx"
  ON "roll_operations" ("createdAt");

-- RollError: hata türü dağılımı, QC2 kararları, scrap kırılımı (processedAt = Tambur kararı)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "roll_errors_detectedAt_idx"
  ON "roll_errors" ("detectedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "roll_errors_processedAt_idx"
  ON "roll_errors" ("processedAt")
  WHERE "processedAt" IS NOT NULL;

-- Shipment: müşteri sevkiyat hacmi, geç teslim (Etap 2)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "shipments_shippedAt_idx"
  ON "shipments" ("shippedAt")
  WHERE "shippedAt" IS NOT NULL;

-- Order: termin / geç teslim filtreleri (Etap 2)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_deadline_idx"
  ON "orders" ("deadline")
  WHERE "deadline" IS NOT NULL;
