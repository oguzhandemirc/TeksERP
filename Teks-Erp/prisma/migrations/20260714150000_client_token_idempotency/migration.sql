-- İdempotency anahtarları (clientToken) — Order/WorkOrder create + kartela stok düşümü
-- replay koruması. Roll.clientToken emsali (20260709100000): kolonlar nullable,
-- unique index'ler PARTIAL (WHERE "clientToken" IS NOT NULL) — NULL'lar çakışmaz,
-- yalnız gerçek istemci token'ları dedup edilir. Prisma 7 partial predicate'i drift saymaz.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "clientToken" UUID;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN "clientToken" UUID;

-- CreateTable: kartela stok düşüm OLAYI — sayaç-bazlı reduceStock'un idempotency çapası
CREATE TABLE "swatch_stock_reductions" (
    "id" UUID NOT NULL,
    "clientToken" UUID,
    "itemId" UUID NOT NULL,
    "colorId" UUID,
    "count" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swatch_stock_reductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (partial unique — NULL-yoğun kolon, Roll.clientToken emsali)
CREATE UNIQUE INDEX "orders_clientToken_key" ON "orders"("clientToken") WHERE "clientToken" IS NOT NULL;

-- CreateIndex (partial unique)
CREATE UNIQUE INDEX "work_orders_clientToken_key" ON "work_orders"("clientToken") WHERE "clientToken" IS NOT NULL;

-- CreateIndex (partial unique)
CREATE UNIQUE INDEX "swatch_stock_reductions_clientToken_key" ON "swatch_stock_reductions"("clientToken") WHERE "clientToken" IS NOT NULL;

-- CreateIndex: düşüm geçmişi (itemId eşitlik + createdAt sıralama); sol-prefix FK'yı kapsar
CREATE INDEX "swatch_stock_reductions_itemId_createdAt_idx" ON "swatch_stock_reductions"("itemId", "createdAt" DESC);

-- CreateIndex: FK index kuralı
CREATE INDEX "swatch_stock_reductions_colorId_idx" ON "swatch_stock_reductions"("colorId");

-- AddForeignKey
ALTER TABLE "swatch_stock_reductions" ADD CONSTRAINT "swatch_stock_reductions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatch_stock_reductions" ADD CONSTRAINT "swatch_stock_reductions_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatch_stock_reductions" ADD CONSTRAINT "swatch_stock_reductions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
