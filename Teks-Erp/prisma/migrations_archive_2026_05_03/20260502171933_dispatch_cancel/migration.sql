-- AlterTable
ALTER TABLE "subcontractor_dispatches" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_cancelledById_idx" ON "subcontractor_dispatches"("cancelledById");

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
