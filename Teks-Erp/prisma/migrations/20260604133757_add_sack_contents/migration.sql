-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "sackId" TEXT;

-- AlterTable
ALTER TABLE "swatches" ADD COLUMN     "sackId" TEXT;

-- CreateIndex
CREATE INDEX "rolls_sackId_idx" ON "rolls"("sackId");

-- CreateIndex
CREATE INDEX "swatches_sackId_idx" ON "swatches"("sackId");

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
