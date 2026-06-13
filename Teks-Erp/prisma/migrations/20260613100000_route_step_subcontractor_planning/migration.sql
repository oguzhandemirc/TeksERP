
-- AlterTable
ALTER TABLE "route_steps" ADD COLUMN     "plannedSubcontractorId" UUID,
ADD COLUMN     "requiredCategoryId" UUID;

-- CreateIndex
CREATE INDEX "route_steps_requiredCategoryId_idx" ON "route_steps"("requiredCategoryId");

-- CreateIndex
CREATE INDEX "route_steps_plannedSubcontractorId_idx" ON "route_steps"("plannedSubcontractorId");

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_requiredCategoryId_fkey" FOREIGN KEY ("requiredCategoryId") REFERENCES "subcontractor_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_plannedSubcontractorId_fkey" FOREIGN KEY ("plannedSubcontractorId") REFERENCES "subcontractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

