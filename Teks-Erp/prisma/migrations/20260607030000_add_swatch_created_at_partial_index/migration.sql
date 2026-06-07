-- Swatch (kartela) cursor listesi + stats partial index.
-- Sorgu: WHERE cancelledAt IS NULL ORDER BY createdAt DESC, id DESC.
-- Swatch'ta createdAt indeksi yoktu → her "daha fazla yükle" seq scan + sort
-- yapıyordu (500k kartelada kritik). Soft-delete tablosu olduğu için PARTIAL:
-- yalnız aktif (cancelledAt IS NULL) satırları indeksler, iptaller dışarıda.
-- statement_timeout=0 zorunlu: canlı DB'de 30s app timeout migration'ı keser.
SET statement_timeout = 0;

DROP INDEX IF EXISTS "swatches_createdAt_idx";
CREATE INDEX "swatches_createdAt_idx" ON "swatches" ("createdAt") WHERE "cancelledAt" IS NULL;
