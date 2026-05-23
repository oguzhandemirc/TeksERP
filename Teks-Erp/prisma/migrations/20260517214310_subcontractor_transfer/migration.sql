-- AlterEnum
ALTER TYPE "RollOperationType" ADD VALUE 'SUBCONTRACTOR_TRANSFERRED';

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "sourceTransferId" TEXT;

-- AlterTable
ALTER TABLE "subcontractor_categories" ADD COLUMN     "returnsOpenFabric" BOOLEAN NOT NULL DEFAULT true;

-- Data fix: "açık kumaş döndürmeyen" mevcut kategoriler için flag'i kapat.
-- Yeni kategoriler default true gelir (mevcut boyahane davranışını korur);
-- admin gerekirse UI üzerinden değiştirir.
UPDATE "subcontractor_categories" SET "returnsOpenFabric" = false WHERE "code" IN ('SANDING', 'WASHING');

-- CreateTable
CREATE TABLE "subcontractor_transfers" (
    "id" TEXT NOT NULL,
    "transferNo" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "fromStepId" TEXT NOT NULL,
    "toStepId" TEXT NOT NULL,
    "fromSubcontractorId" TEXT NOT NULL,
    "toSubcontractorId" TEXT NOT NULL,
    "manifestNo" TEXT,
    "appliedColorId" TEXT,
    "notes" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transferredById" TEXT,
    "printSnapshot" JSONB,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcontractor_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_transfer_items" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "newRollId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_transfer_consumed" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_transfer_consumed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_transfer_properties" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_transfer_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_transfers_transferNo_key" ON "subcontractor_transfers"("transferNo");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_workOrderId_idx" ON "subcontractor_transfers"("workOrderId");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_fromStepId_idx" ON "subcontractor_transfers"("fromStepId");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_toStepId_idx" ON "subcontractor_transfers"("toStepId");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_fromSubcontractorId_idx" ON "subcontractor_transfers"("fromSubcontractorId");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_toSubcontractorId_idx" ON "subcontractor_transfers"("toSubcontractorId");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_appliedColorId_idx" ON "subcontractor_transfers"("appliedColorId");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_transferredById_idx" ON "subcontractor_transfers"("transferredById");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_cancelledById_idx" ON "subcontractor_transfers"("cancelledById");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_transferredAt_idx" ON "subcontractor_transfers"("transferredAt");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_workOrderId_transferredAt_idx" ON "subcontractor_transfers"("workOrderId", "transferredAt");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_fromSubcontractorId_transferredAt_idx" ON "subcontractor_transfers"("fromSubcontractorId", "transferredAt");

-- CreateIndex
CREATE INDEX "subcontractor_transfers_toSubcontractorId_transferredAt_idx" ON "subcontractor_transfers"("toSubcontractorId", "transferredAt");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_transfer_items_newRollId_key" ON "subcontractor_transfer_items"("newRollId");

-- CreateIndex
CREATE INDEX "subcontractor_transfer_items_transferId_idx" ON "subcontractor_transfer_items"("transferId");

-- CreateIndex
CREATE INDEX "subcontractor_transfer_consumed_transferId_idx" ON "subcontractor_transfer_consumed"("transferId");

-- CreateIndex
CREATE INDEX "subcontractor_transfer_consumed_rollId_idx" ON "subcontractor_transfer_consumed"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_transfer_consumed_transferId_rollId_key" ON "subcontractor_transfer_consumed"("transferId", "rollId");

-- CreateIndex
CREATE INDEX "subcontractor_transfer_properties_propertyId_idx" ON "subcontractor_transfer_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_transfer_properties_transferId_propertyId_key" ON "subcontractor_transfer_properties"("transferId", "propertyId");

-- CreateIndex
CREATE INDEX "rolls_sourceTransferId_idx" ON "rolls"("sourceTransferId");

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sourceTransferId_fkey" FOREIGN KEY ("sourceTransferId") REFERENCES "subcontractor_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfers" ADD CONSTRAINT "subcontractor_transfers_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfers" ADD CONSTRAINT "subcontractor_transfers_fromStepId_fkey" FOREIGN KEY ("fromStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfers" ADD CONSTRAINT "subcontractor_transfers_toStepId_fkey" FOREIGN KEY ("toStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfers" ADD CONSTRAINT "subcontractor_transfers_fromSubcontractorId_fkey" FOREIGN KEY ("fromSubcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfers" ADD CONSTRAINT "subcontractor_transfers_toSubcontractorId_fkey" FOREIGN KEY ("toSubcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfers" ADD CONSTRAINT "subcontractor_transfers_appliedColorId_fkey" FOREIGN KEY ("appliedColorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfers" ADD CONSTRAINT "subcontractor_transfers_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfers" ADD CONSTRAINT "subcontractor_transfers_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfer_items" ADD CONSTRAINT "subcontractor_transfer_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "subcontractor_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfer_items" ADD CONSTRAINT "subcontractor_transfer_items_newRollId_fkey" FOREIGN KEY ("newRollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfer_consumed" ADD CONSTRAINT "subcontractor_transfer_consumed_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "subcontractor_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfer_consumed" ADD CONSTRAINT "subcontractor_transfer_consumed_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfer_properties" ADD CONSTRAINT "subcontractor_transfer_properties_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "subcontractor_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_transfer_properties" ADD CONSTRAINT "subcontractor_transfer_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
