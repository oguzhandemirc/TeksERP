-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "needsReprint" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "rolls_needsReprint_idx" ON "rolls"("needsReprint");
