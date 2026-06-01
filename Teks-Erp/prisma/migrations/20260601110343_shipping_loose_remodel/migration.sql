/*
  Warnings:

  - You are about to drop the column `sackId` on the `rolls` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `sacks` table. All the data in the column will be lost.
  - You are about to drop the column `closedAt` on the `sacks` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `sacks` table. All the data in the column will be lost.
  - You are about to drop the column `shipToAddress` on the `sacks` table. All the data in the column will be lost.
  - You are about to drop the column `shipToCity` on the `sacks` table. All the data in the column will be lost.
  - You are about to drop the column `shipToDistrict` on the `sacks` table. All the data in the column will be lost.
  - You are about to drop the column `shipToName` on the `sacks` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `sacks` table. All the data in the column will be lost.
  - You are about to drop the column `sackId` on the `swatches` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "ShipmentStatus" ADD VALUE 'READY';

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_sackId_fkey";

-- DropForeignKey
ALTER TABLE "sacks" DROP CONSTRAINT "sacks_branchId_fkey";

-- DropForeignKey
ALTER TABLE "sacks" DROP CONSTRAINT "sacks_customerId_fkey";

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_sackId_fkey";

-- DropIndex
DROP INDEX "rolls_needsReprint_idx";

-- DropIndex
DROP INDEX "rolls_sackId_idx";

-- DropIndex
DROP INDEX "sacks_branchId_idx";

-- DropIndex
DROP INDEX "sacks_customerId_status_idx";

-- DropIndex
DROP INDEX "sacks_status_createdAt_idx";

-- DropIndex
DROP INDEX "swatches_sackId_idx";

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "shippedQty" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "rolls" DROP COLUMN "sackId",
ADD COLUMN     "shipmentId" TEXT;

-- AlterTable
ALTER TABLE "sacks" DROP COLUMN "branchId",
DROP COLUMN "closedAt",
DROP COLUMN "customerId",
DROP COLUMN "shipToAddress",
DROP COLUMN "shipToCity",
DROP COLUMN "shipToDistrict",
DROP COLUMN "shipToName",
DROP COLUMN "status",
ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "readyAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "swatches" DROP COLUMN "sackId",
ADD COLUMN     "shipmentId" TEXT;

-- DropEnum
DROP TYPE "SackStatus";

-- CreateTable
CREATE TABLE "shipment_orders" (
    "shipmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_orders_pkey" PRIMARY KEY ("shipmentId","orderId")
);

-- CreateTable
CREATE TABLE "shipment_allocations" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_orders_orderId_idx" ON "shipment_orders"("orderId");

-- CreateIndex
CREATE INDEX "shipment_allocations_shipmentId_idx" ON "shipment_allocations"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_allocations_orderLineId_idx" ON "shipment_allocations"("orderLineId");

-- CreateIndex
CREATE INDEX "rolls_shipmentId_idx" ON "rolls"("shipmentId");

-- CreateIndex
CREATE INDEX "rolls_status_itemId_colorId_width_idx" ON "rolls"("status", "itemId", "colorId", "width");

-- CreateIndex
CREATE INDEX "swatches_shipmentId_idx" ON "swatches"("shipmentId");

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_orders" ADD CONSTRAINT "shipment_orders_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_orders" ADD CONSTRAINT "shipment_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_allocations" ADD CONSTRAINT "shipment_allocations_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_allocations" ADD CONSTRAINT "shipment_allocations_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
