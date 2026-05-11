-- =============================================================================
-- Roll.entrySource — top'un sisteme nasıl girdiğini ifade eder.
-- itemType "ne olduğu", entrySource "nereden geldiği".
-- Raporlama ayrımı için: "ne kadar ham kumaş ürettim", "ne kadar mal aldım",
-- "ne kadar hizmet üretimi yaptım" sorularına cevap verir.
-- =============================================================================

-- CreateEnum
CREATE TYPE "RollEntrySource" AS ENUM ('PRODUCTION', 'SUPPLIER_RECEIPT', 'CUSTOMER_SUPPLIED');

-- AlterTable: Roll — entrySource kolonu (default SUPPLIER_RECEIPT, sonra backfill)
ALTER TABLE "rolls"
  ADD COLUMN "entrySource" "RollEntrySource" NOT NULL DEFAULT 'SUPPLIER_RECEIPT';

-- Backfill 1: müşteri malı toplar → CUSTOMER_SUPPLIED (SERVICE_PRODUCTION)
UPDATE "rolls"
   SET "entrySource" = 'CUSTOMER_SUPPLIED'
 WHERE "ownerCustomerId" IS NOT NULL;

-- Backfill 2: ham kumaş (RAW_FABRIC) ve müşteri malı değilse → PRODUCTION (içeride üretildi)
UPDATE "rolls" r
   SET "entrySource" = 'PRODUCTION'
  FROM "items" i
 WHERE r."itemId" = i."id"
   AND i."itemType" = 'RAW_FABRIC'
   AND r."ownerCustomerId" IS NULL;

-- CreateIndex: kaynak bazlı dönem raporları için (örn. WHERE entrySource='PRODUCTION' AND createdAt BETWEEN ...)
CREATE INDEX "rolls_entrySource_createdAt_idx" ON "rolls"("entrySource", "createdAt");
