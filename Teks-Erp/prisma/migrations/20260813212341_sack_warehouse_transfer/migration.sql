-- AlterTable
ALTER TABLE "sacks" ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "warehouse_movements" ADD COLUMN     "sackId" UUID;

-- CreateIndex
CREATE INDEX "sacks_warehouseId_idx" ON "sacks"("warehouseId") WHERE "warehouseId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "warehouse_movements_sackId_idx" ON "warehouse_movements"("sackId") WHERE "sackId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
