-- CreateEnum
CREATE TYPE "SackStatus" AS ENUM ('OPEN', 'CLOSED', 'SHIPPED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PREPARING', 'DISPATCHED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "RollStatus" ADD VALUE 'SHIPPED';

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "cutNote" TEXT,
ADD COLUMN     "pieceLengthM" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "sackId" TEXT,
ADD COLUMN     "targetOrderLineId" TEXT;

-- AlterTable
ALTER TABLE "swatches" ADD COLUMN     "sackId" TEXT,
ADD COLUMN     "targetOrderLineId" TEXT;

-- CreateTable
CREATE TABLE "sacks" (
    "id" TEXT NOT NULL,
    "sackNo" VARCHAR(64) NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT,
    "status" "SackStatus" NOT NULL DEFAULT 'OPEN',
    "weightKg" DECIMAL(12,3),
    "shipToName" VARCHAR(100),
    "shipToAddress" TEXT,
    "shipToCity" TEXT,
    "shipToDistrict" TEXT,
    "shipmentId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "shipmentNo" VARCHAR(64) NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PREPARING',
    "plateNumber" VARCHAR(32),
    "driverName" VARCHAR(100),
    "carrier" VARCHAR(100),
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sacks_sackNo_key" ON "sacks"("sackNo");

-- CreateIndex
CREATE INDEX "sacks_customerId_status_idx" ON "sacks"("customerId", "status");

-- CreateIndex
CREATE INDEX "sacks_branchId_idx" ON "sacks"("branchId");

-- CreateIndex
CREATE INDEX "sacks_shipmentId_idx" ON "sacks"("shipmentId");

-- CreateIndex
CREATE INDEX "sacks_status_createdAt_idx" ON "sacks"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_shipmentNo_key" ON "shipments"("shipmentNo");

-- CreateIndex
CREATE INDEX "shipments_customerId_status_idx" ON "shipments"("customerId", "status");

-- CreateIndex
CREATE INDEX "shipments_branchId_idx" ON "shipments"("branchId");

-- CreateIndex
CREATE INDEX "shipments_status_createdAt_idx" ON "shipments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "rolls_targetOrderLineId_idx" ON "rolls"("targetOrderLineId");

-- CreateIndex
CREATE INDEX "rolls_sackId_idx" ON "rolls"("sackId");

-- CreateIndex
CREATE INDEX "swatches_targetOrderLineId_idx" ON "swatches"("targetOrderLineId");

-- CreateIndex
CREATE INDEX "swatches_sackId_idx" ON "swatches"("sackId");

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_targetOrderLineId_fkey" FOREIGN KEY ("targetOrderLineId") REFERENCES "order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_targetOrderLineId_fkey" FOREIGN KEY ("targetOrderLineId") REFERENCES "order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
