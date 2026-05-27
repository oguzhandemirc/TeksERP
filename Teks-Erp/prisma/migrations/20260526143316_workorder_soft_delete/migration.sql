-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "work_orders_isActive_idx" ON "work_orders"("isActive");
