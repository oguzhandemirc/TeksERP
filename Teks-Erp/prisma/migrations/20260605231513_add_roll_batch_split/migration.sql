-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "batchSplitId" TEXT;

-- CreateIndex
CREATE INDEX "rolls_batchSplitId_idx" ON "rolls"("batchSplitId");
