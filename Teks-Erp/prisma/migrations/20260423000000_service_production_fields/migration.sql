-- AlterEnum: WorkOrderType — SERVICE_PRODUCTION eklendi (Fason Üretim Kabul)
ALTER TYPE "WorkOrderType" ADD VALUE IF NOT EXISTS 'SERVICE_PRODUCTION';

-- AlterTable: Roll — müşteri malı (fason üretim kabul) alanları
ALTER TABLE "rolls"
  ADD COLUMN "ownerCustomerId"     TEXT,
  ADD COLUMN "customerDescription" TEXT;

-- AlterTable: WorkOrder — fason üretimde metre başı hizmet bedeli
ALTER TABLE "work_orders"
  ADD COLUMN "servicePricePerMeter" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "rolls_ownerCustomerId_idx" ON "rolls"("ownerCustomerId");

-- AddForeignKey
ALTER TABLE "rolls"
  ADD CONSTRAINT "rolls_ownerCustomerId_fkey"
  FOREIGN KEY ("ownerCustomerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
