-- AlterEnum
ALTER TYPE "RollStatus" ADD VALUE 'SUBCONTRACTOR_CONSUMED';

-- AlterTable
ALTER TABLE "roll_errors" ALTER COLUMN "endMeter" DROP NOT NULL;

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "parentReceiptId" TEXT,
ALTER COLUMN "barcode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "subcontractor_receipts" ADD COLUMN     "appliedColorId" TEXT;

-- CreateTable
CREATE TABLE "subcontractor_receipt_properties" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_receipt_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subcontractor_receipt_properties_propertyId_idx" ON "subcontractor_receipt_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_receipt_properties_receiptId_propertyId_key" ON "subcontractor_receipt_properties"("receiptId", "propertyId");

-- CreateIndex
CREATE INDEX "rolls_parentReceiptId_idx" ON "rolls"("parentReceiptId");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_appliedColorId_idx" ON "subcontractor_receipts"("appliedColorId");

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_parentReceiptId_fkey" FOREIGN KEY ("parentReceiptId") REFERENCES "subcontractor_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_appliedColorId_fkey" FOREIGN KEY ("appliedColorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipt_properties" ADD CONSTRAINT "subcontractor_receipt_properties_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "subcontractor_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipt_properties" ADD CONSTRAINT "subcontractor_receipt_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
