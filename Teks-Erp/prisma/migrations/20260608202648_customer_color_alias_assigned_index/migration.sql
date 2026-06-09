-- DropIndex
DROP INDEX "customer_color_aliases_colorId_idx";

-- CreateIndex
CREATE INDEX "customer_color_aliases_colorId_assigned_idx" ON "customer_color_aliases"("colorId", "assigned");
