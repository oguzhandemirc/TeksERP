-- Faz B — top→sipariş bağı (targetOrderLineId) + reprint kuyruğu (needsReprint) kaldırıldı.
-- Gevşek model: etiket müşterisi baskı anında seçilir; karşılanma spec-toplam (ShipmentAllocation).

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_targetOrderLineId_fkey";
-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_targetOrderLineId_fkey";
-- DropIndex
DROP INDEX "rolls_targetOrderLineId_idx";
-- DropIndex
DROP INDEX "swatches_targetOrderLineId_idx";
-- AlterTable
ALTER TABLE "rolls" DROP COLUMN "needsReprint",
DROP COLUMN "targetOrderLineId";
-- AlterTable
ALTER TABLE "swatches" DROP COLUMN "targetOrderLineId";
