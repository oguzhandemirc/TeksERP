-- =============================================================================
-- Shipment.shippedById — sevki finalize eden kullanıcı (audit)
-- =============================================================================
-- Roll history SHIPPED event'inde "kim sevk etti" bilgisi gözükmesi için.
-- Mevcut sevkler için NULL (geçmiş audit AuditService.log'da SystemLog'da var).
--
-- ADD COLUMN nullable + ADD CONSTRAINT FK + CREATE INDEX CONCURRENTLY.
-- ALTER TABLE ADD COLUMN nullable: instant, lock'sız.
-- ADD FOREIGN KEY: kısa exclusive lock (FK validation tablo boyutuna bağlı).
-- CREATE INDEX CONCURRENTLY: tabloyu yazmaya kapatmaz; transaction-dışı çalışır.
--
-- Production deploy: psql -f migration.sql + prisma migrate resolve --applied.
-- Prisma migrate dev/deploy CONCURRENTLY'i transaction'a saracağı için kullanma.
-- =============================================================================

-- 1) Kolon ekle (nullable — mevcut kayıtlar etkilenmez)
-- TEXT tipinde — User.id Prisma'nın default String tipiyle TEXT olarak yaratılır.
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "shippedById" TEXT;

-- 2) FK constraint
ALTER TABLE "shipments"
  DROP CONSTRAINT IF EXISTS "shipments_shippedById_fkey";

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_shippedById_fkey"
  FOREIGN KEY ("shippedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Index — CONCURRENTLY (canlı tabloda yazmayı kilitlemez)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "shipments_shippedById_idx"
  ON "shipments" ("shippedById");
