-- CreateTable
CREATE TABLE "return_reasons" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "color" VARCHAR(7),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roll_returns" (
    "id" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "fromShipmentId" TEXT,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "itemId" TEXT NOT NULL,
    "colorId" TEXT,
    "width" DECIMAL(12,3),
    "qty" DECIMAL(12,3) NOT NULL,
    "reasonId" TEXT,
    "reasonText" TEXT,
    "note" TEXT,
    "qualityGradeId" TEXT,
    "receivedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_reasons_code_key" ON "return_reasons"("code");

-- CreateIndex
CREATE INDEX "return_reasons_isActive_sortOrder_idx" ON "return_reasons"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "roll_returns_orderId_idx" ON "roll_returns"("orderId");

-- CreateIndex
CREATE INDEX "roll_returns_customerId_createdAt_idx" ON "roll_returns"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "roll_returns_itemId_colorId_width_idx" ON "roll_returns"("itemId", "colorId", "width");

-- CreateIndex
CREATE INDEX "roll_returns_fromShipmentId_idx" ON "roll_returns"("fromShipmentId");

-- CreateIndex
CREATE INDEX "roll_returns_rollId_idx" ON "roll_returns"("rollId");

-- CreateIndex
CREATE INDEX "roll_returns_reasonId_idx" ON "roll_returns"("reasonId");

-- CreateIndex
CREATE INDEX "roll_returns_receivedById_idx" ON "roll_returns"("receivedById");

-- CreateIndex
CREATE INDEX "roll_returns_qualityGradeId_idx" ON "roll_returns"("qualityGradeId");

-- CreateIndex
CREATE INDEX "roll_returns_createdAt_idx" ON "roll_returns"("createdAt");

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_fromShipmentId_fkey" FOREIGN KEY ("fromShipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "return_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_qualityGradeId_fkey" FOREIGN KEY ("qualityGradeId") REFERENCES "quality_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
