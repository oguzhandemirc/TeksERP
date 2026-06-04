/*
  Warnings:

  - You are about to drop the column `workOrderId` on the `swatches` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RollStatus" ADD VALUE 'AT_KARTELA';
ALTER TYPE "RollStatus" ADD VALUE 'KARTELA_CONSUMED';

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_workOrderId_fkey";

-- DropIndex
DROP INDEX "swatches_workOrderId_idx";

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "markedForKartela" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "swatches" DROP COLUMN "workOrderId",
ADD COLUMN     "parentReceiptId" TEXT,
ALTER COLUMN "length" DROP NOT NULL;

-- CreateTable
CREATE TABLE "kartela_dispatches" (
    "id" TEXT NOT NULL,
    "dispatchNo" VARCHAR(64) NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "plateNumber" TEXT,
    "driverName" TEXT,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedById" TEXT,
    "notes" TEXT,
    "totalQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "printSnapshot" JSONB,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kartela_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kartela_dispatch_items" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "dispatchedQty" DECIMAL(12,3) NOT NULL,
    "dispatchedWeight" DECIMAL(12,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kartela_dispatch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kartela_receipts" (
    "id" TEXT NOT NULL,
    "receiptNo" VARCHAR(64) NOT NULL,
    "manifestNo" VARCHAR(64),
    "dispatchId" TEXT,
    "subcontractorId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kartela_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kartela_receipt_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "consumedRollId" TEXT NOT NULL,
    "sourceDispatchItemId" TEXT,
    "kartelaCount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kartela_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kartela_dispatches_dispatchNo_key" ON "kartela_dispatches"("dispatchNo");

-- CreateIndex
CREATE INDEX "kartela_dispatches_dispatchedAt_idx" ON "kartela_dispatches"("dispatchedAt");

-- CreateIndex
CREATE INDEX "kartela_dispatches_subcontractorId_dispatchedAt_idx" ON "kartela_dispatches"("subcontractorId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "kartela_dispatches_dispatchedById_idx" ON "kartela_dispatches"("dispatchedById");

-- CreateIndex
CREATE INDEX "kartela_dispatches_cancelledById_idx" ON "kartela_dispatches"("cancelledById");

-- CreateIndex
CREATE INDEX "kartela_dispatch_items_dispatchId_idx" ON "kartela_dispatch_items"("dispatchId");

-- CreateIndex
CREATE INDEX "kartela_dispatch_items_rollId_idx" ON "kartela_dispatch_items"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "kartela_receipts_receiptNo_key" ON "kartela_receipts"("receiptNo");

-- CreateIndex
CREATE INDEX "kartela_receipts_receivedAt_idx" ON "kartela_receipts"("receivedAt");

-- CreateIndex
CREATE INDEX "kartela_receipts_subcontractorId_receivedAt_idx" ON "kartela_receipts"("subcontractorId", "receivedAt");

-- CreateIndex
CREATE INDEX "kartela_receipts_dispatchId_idx" ON "kartela_receipts"("dispatchId");

-- CreateIndex
CREATE INDEX "kartela_receipts_receivedById_idx" ON "kartela_receipts"("receivedById");

-- CreateIndex
CREATE INDEX "kartela_receipts_cancelledById_idx" ON "kartela_receipts"("cancelledById");

-- CreateIndex
CREATE INDEX "kartela_receipt_items_receiptId_idx" ON "kartela_receipt_items"("receiptId");

-- CreateIndex
CREATE INDEX "kartela_receipt_items_consumedRollId_idx" ON "kartela_receipt_items"("consumedRollId");

-- CreateIndex
CREATE INDEX "kartela_receipt_items_sourceDispatchItemId_idx" ON "kartela_receipt_items"("sourceDispatchItemId");

-- CreateIndex
CREATE UNIQUE INDEX "kartela_receipt_items_receiptId_consumedRollId_key" ON "kartela_receipt_items"("receiptId", "consumedRollId");

-- CreateIndex
CREATE INDEX "swatches_parentReceiptId_idx" ON "swatches"("parentReceiptId");

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_parentReceiptId_fkey" FOREIGN KEY ("parentReceiptId") REFERENCES "kartela_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatches" ADD CONSTRAINT "kartela_dispatches_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatches" ADD CONSTRAINT "kartela_dispatches_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatches" ADD CONSTRAINT "kartela_dispatches_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatch_items" ADD CONSTRAINT "kartela_dispatch_items_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "kartela_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatch_items" ADD CONSTRAINT "kartela_dispatch_items_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipts" ADD CONSTRAINT "kartela_receipts_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "kartela_dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipts" ADD CONSTRAINT "kartela_receipts_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipts" ADD CONSTRAINT "kartela_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipts" ADD CONSTRAINT "kartela_receipts_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipt_items" ADD CONSTRAINT "kartela_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "kartela_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipt_items" ADD CONSTRAINT "kartela_receipt_items_consumedRollId_fkey" FOREIGN KEY ("consumedRollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipt_items" ADD CONSTRAINT "kartela_receipt_items_sourceDispatchItemId_fkey" FOREIGN KEY ("sourceDispatchItemId") REFERENCES "kartela_dispatch_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
