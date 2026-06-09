-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "splitFromId" TEXT;

-- CreateIndex — null-yoğun kolon: drift-free partial pattern (şemada @@index kalır,
-- burada IS NOT NULL partial'a çevrilir; Prisma 7 partial predicate'i drift saymaz).
CREATE INDEX "work_orders_splitFromId_idx" ON "work_orders"("splitFromId") WHERE "splitFromId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_splitFromId_fkey" FOREIGN KEY ("splitFromId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
