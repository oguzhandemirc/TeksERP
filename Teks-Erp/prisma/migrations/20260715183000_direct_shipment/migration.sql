-- Prisma-authored diff'ten türetildi; datamodel DIŞI custom raw composite FK
-- drop'ları (rolls/swatches _sackId_shipmentId_consistency_fkey) KASTEN ÇIKARILDI —
-- bkz. 20260713120000_parti_modeli aynı gerekçe. Prisma'nın datamodel'de temsil
-- edemediği raw/composite FK'lar her migrate diff'te spurious "drop" üretir; gerçek
-- şema değişikliği YOK. Bu migration YALNIZ DirectShipment entity'sini ekler
-- (fasondan doğrudan müşteriye sevk olayı — roll-bazlı, çuval Shipment'tan ayrı).

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "directShipmentId" UUID;

-- AlterTable
ALTER TABLE "subcontractor_direct_ship_allocations" ADD COLUMN     "directShipmentId" UUID;

-- CreateTable
CREATE TABLE "direct_shipments" (
    "id" UUID NOT NULL,
    "shipmentNo" TEXT NOT NULL,
    "dispatchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "branchId" UUID,
    "reason" TEXT NOT NULL,
    "totalQty" DECIMAL(12,3) NOT NULL,
    "rollCount" INTEGER NOT NULL,
    "shippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shippedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direct_shipments_shipmentNo_key" ON "direct_shipments"("shipmentNo");

-- CreateIndex
CREATE INDEX "direct_shipments_dispatchId_idx" ON "direct_shipments"("dispatchId");

-- CreateIndex
CREATE INDEX "direct_shipments_customerId_idx" ON "direct_shipments"("customerId");

-- CreateIndex
CREATE INDEX "direct_shipments_shippedAt_idx" ON "direct_shipments"("shippedAt");

-- CreateIndex
CREATE INDEX "subcontractor_direct_ship_allocations_directShipmentId_idx" ON "subcontractor_direct_ship_allocations"("directShipmentId");

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_directShipmentId_fkey" FOREIGN KEY ("directShipmentId") REFERENCES "direct_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_direct_ship_allocations" ADD CONSTRAINT "subcontractor_direct_ship_allocations_directShipmentId_fkey" FOREIGN KEY ("directShipmentId") REFERENCES "direct_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_shipments" ADD CONSTRAINT "direct_shipments_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "subcontractor_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_shipments" ADD CONSTRAINT "direct_shipments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_shipments" ADD CONSTRAINT "direct_shipments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_shipments" ADD CONSTRAINT "direct_shipments_shippedById_fkey" FOREIGN KEY ("shippedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
