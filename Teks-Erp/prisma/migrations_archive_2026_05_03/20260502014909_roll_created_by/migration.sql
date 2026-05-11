-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "rolls_createdById_idx" ON "rolls"("createdById");

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
