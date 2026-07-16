-- =============================================================================
-- Batch.mergedIntoId — merge soy bağı (K17, PARTI-AYIR-BIRLESTIR-V2-TASARIM.md)
-- =============================================================================
-- Merge'de boşalan kaynak parti SİLİNMEZ; mergedIntoId = survivor ile tarihçe
-- satırı olarak yaşar ("kaynak lot sıfırlanır ama kaydı yaşar").
--
-- Prisma-authored diff'ten türetildi; datamodel DIŞI custom raw constraint
-- drop'ları (rolls/swatches _sackId_shipmentId_consistency_fkey) KASTEN ÇIKARILDI —
-- bkz. 20260713120000_parti_modeli aynı gerekçe. Bunlar Prisma'nın datamodel'de
-- temsil edemediği raw/composite FK'lar olduğundan her diff'te spurious drop
-- üretiyor; gerçek şema değişikliği yalnız aşağıdaki üç statement.
-- =============================================================================

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "mergedIntoId" UUID;

-- CreateIndex — PARTIAL (null-yoğun merge soy bağı) — drift-free
CREATE INDEX "batches_mergedIntoId_idx" ON "batches"("mergedIntoId") WHERE "mergedIntoId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
