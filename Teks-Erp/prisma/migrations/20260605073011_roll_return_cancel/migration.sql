-- AlterTable
ALTER TABLE "roll_returns" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "prevQualityGrade" TEXT,
ADD COLUMN     "prevQualityGradeId" TEXT,
ADD COLUMN     "prevSackId" TEXT;

-- CreateIndex
CREATE INDEX "roll_returns_cancelledById_idx" ON "roll_returns"("cancelledById");

-- CreateIndex
CREATE INDEX "roll_returns_cancelledAt_idx" ON "roll_returns"("cancelledAt");

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
