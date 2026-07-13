-- =============================================================================
-- Parti Modeli — İş Emri ≠ Parti ayrışması (PARTI-MODELI-TASARIM.md)
-- =============================================================================
-- WorkOrder.batchNumber → workOrderNumber (IE…); yeni Batch (parti, P…) modeli;
-- Roll.batchSplitId → batchId (gerçek FK); TravelerCard.workOrderId → batchId
-- (kart parti başına); SubcontractorDispatch.batchId (bir sevk = bir parti, K10).
--
-- Prisma-authored diff'ten türetildi; datamodel DIŞI custom raw constraint drop'ları
-- (sacks_customerId_fkey, rolls/swatches _sackId_shipmentId_consistency_fkey) KASTEN
-- ÇIKARILDI — onlar korunur. Operasyonel tablolar reset sonrası BOŞ (tüm veri test
-- verisi) → NOT NULL/FK güvenli.
-- Null-yoğun index'ler + one-ACTIVE-per-batch PARTIAL yazıldı (drift-free: Prisma 7
-- partial predicate'i drift saymaz; schema.prisma'da düz @@index görünür).
-- =============================================================================

-- Büyük tabloda index/DDL statement_timeout(50s) tuzağına karşı (D-14). Boş kurulumda no-op.
SET statement_timeout = 0;

-- DropForeignKey / DropIndex — eski WO-bağlı kart + parti kodu index'leri.
-- (traveler_cards_wo_active_uniq, workOrderId sütun drop'uyla cascade düşer; açık DROP güvenli.)
ALTER TABLE "traveler_cards" DROP CONSTRAINT "traveler_cards_workOrderId_fkey";
DROP INDEX "traveler_cards_workOrderId_idx";
DROP INDEX IF EXISTS "traveler_cards_wo_active_uniq";
DROP INDEX "work_orders_batchNumber_key";

-- AlterTable — kolon geçişleri
ALTER TABLE "rolls" DROP COLUMN "batchSplitId",
ADD COLUMN     "batchId" UUID;

ALTER TABLE "subcontractor_dispatches" ADD COLUMN     "batchId" UUID NOT NULL;

ALTER TABLE "traveler_cards" DROP COLUMN "workOrderId",
ADD COLUMN     "batchId" UUID NOT NULL;

ALTER TABLE "work_orders" DROP COLUMN "batchNumber",
ADD COLUMN     "workOrderNumber" VARCHAR(64) NOT NULL;

-- CreateTable — Batch (parti)
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "batchNumber" VARCHAR(64) NOT NULL,
    "workOrderId" UUID NOT NULL,
    "splitFromId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "batches_batchNumber_key" ON "batches"("batchNumber");
CREATE INDEX "batches_workOrderId_idx" ON "batches"("workOrderId");
-- PARTIAL (null-yoğun soy bağı) — drift-free
CREATE INDEX "batches_splitFromId_idx" ON "batches"("splitFromId") WHERE "splitFromId" IS NOT NULL;

-- PARTIAL (null-yoğun parti üyeliği) — drift-free
CREATE INDEX "rolls_batchId_idx" ON "rolls"("batchId") WHERE "batchId" IS NOT NULL;

CREATE INDEX "subcontractor_dispatches_batchId_idx" ON "subcontractor_dispatches"("batchId");

CREATE INDEX "traveler_cards_batchId_idx" ON "traveler_cards"("batchId");
-- PARTIAL UNIQUE — parti başına EN FAZLA 1 ACTIVE kart (drift-free; eski wo_active_uniq deseni)
CREATE UNIQUE INDEX "traveler_cards_batch_active_uniq" ON "traveler_cards"("batchId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "work_orders_workOrderNumber_key" ON "work_orders"("workOrderNumber");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batches" ADD CONSTRAINT "batches_splitFromId_fkey" FOREIGN KEY ("splitFromId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "traveler_cards" ADD CONSTRAINT "traveler_cards_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
