-- =============================================================================
-- Sack (Çuval) modeli + Roll.sackId + Swatch.sackId + Swatch.weightKg
-- =============================================================================
-- Çuval = bir müşteriye ait, içinde N top ve N kartela.
-- Status alanı yok: depodaki çuvallar shipmentId IS NULL.
--
-- Index'ler CONCURRENTLY ile (production-safe). FK constraint'ler kısa lock
-- gerektirir ama küçük tabloda anlık.
-- =============================================================================

-- 1) Sacks tablosu
CREATE TABLE IF NOT EXISTS "sacks" (
  "id"          TEXT PRIMARY KEY,
  "sackNumber"  TEXT NOT NULL UNIQUE,
  "customerId"  TEXT NOT NULL,
  "weightKg"    DOUBLE PRECISION,
  "notes"       TEXT,
  "shipmentId"  TEXT,
  "shippedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sacks_customerId_fkey" FOREIGN KEY ("customerId")
    REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sacks_shipmentId_fkey" FOREIGN KEY ("shipmentId")
    REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 2) Roll.sackId — top hangi çuvalda
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "sackId" TEXT;
ALTER TABLE "rolls" DROP CONSTRAINT IF EXISTS "rolls_sackId_fkey";
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sackId_fkey"
  FOREIGN KEY ("sackId") REFERENCES "sacks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Swatch.sackId — kartela hangi çuvalda
ALTER TABLE "swatches" ADD COLUMN IF NOT EXISTS "sackId" TEXT;
ALTER TABLE "swatches" DROP CONSTRAINT IF EXISTS "swatches_sackId_fkey";
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_sackId_fkey"
  FOREIGN KEY ("sackId") REFERENCES "sacks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Swatch.weightKg — kartela ağırlığı (ihracat araç kapasitesi için kritik)
ALTER TABLE "swatches" ADD COLUMN IF NOT EXISTS "weightKg" DOUBLE PRECISION;

-- 5) Index'ler — CONCURRENTLY (live tabloda yazma kilitlemez)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sacks_customerId_idx"
  ON "sacks" ("customerId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sacks_shipmentId_idx"
  ON "sacks" ("shipmentId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sacks_customerId_shipmentId_idx"
  ON "sacks" ("customerId", "shipmentId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "rolls_sackId_idx"
  ON "rolls" ("sackId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "swatches_sackId_idx"
  ON "swatches" ("sackId");
