-- K18 (2026-11-03): sevkiyatta opsiyonel teslim yeri (cari + serbest adres). NULL = bugünkü davranış.
-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "deliveryAddress" VARCHAR(500),
ADD COLUMN     "deliveryCustomerId" UUID;

-- CreateIndex
CREATE INDEX "shipments_deliveryCustomerId_idx" ON "shipments"("deliveryCustomerId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_deliveryCustomerId_fkey" FOREIGN KEY ("deliveryCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
