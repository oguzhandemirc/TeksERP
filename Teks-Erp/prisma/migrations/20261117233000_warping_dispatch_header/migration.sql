-- FASON DEVERE D4b (2026-11-17) — devere siparişine iplik sevki. YALNIZ EKLEME: `subcontractor_dispatches`e iki
-- nullable kolon (başlık üçüncü kolu + idempotency anahtarı) ve başlık CHECK'inin üçüncü kola genişletilmesi.
-- Mevcut her satır iş emri ya da dokuma kolundadır, `warpingOrderId` NULL — yeni CHECK hiçbir satırı reddetmez.

-- AlterTable
ALTER TABLE "subcontractor_dispatches" ADD COLUMN     "clientToken" UUID,
ADD COLUMN     "warpingOrderId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_dispatches_clientToken_key" ON "subcontractor_dispatches"("clientToken");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_warpingOrderId_dispatchedAt_idx" ON "subcontractor_dispatches"("warpingOrderId", "dispatchedAt");

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Başlık: iş emri adımı · dokuma işi · devere siparişi — TAM BİRİ (`test_db_invariants` envanteri; birincil kapı serviste).
-- NOT VALID → VALIDATE: ekleme kilidi kısa, doğrulama satırları kilitlemeden tarar.
ALTER TABLE "subcontractor_dispatches" DROP CONSTRAINT IF EXISTS "subcontractor_dispatches_header_ck";
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_header_ck" CHECK (
  ("workOrderId" IS NOT NULL AND "stepId" IS NOT NULL AND "batchId" IS NOT NULL AND "weavingOrderId" IS NULL AND "warpingOrderId" IS NULL)
  OR ("workOrderId" IS NULL AND "stepId" IS NULL AND "batchId" IS NULL AND "weavingOrderId" IS NOT NULL AND "warpingOrderId" IS NULL)
  OR ("workOrderId" IS NULL AND "stepId" IS NULL AND "batchId" IS NULL AND "weavingOrderId" IS NULL AND "warpingOrderId" IS NOT NULL)
) NOT VALID;
ALTER TABLE "subcontractor_dispatches" VALIDATE CONSTRAINT "subcontractor_dispatches_header_ck";
