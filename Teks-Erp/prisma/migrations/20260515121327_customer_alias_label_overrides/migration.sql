-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "customerColorName" TEXT,
ADD COLUMN     "customerItemName" TEXT;

-- CreateTable
CREATE TABLE "customer_item_aliases" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_item_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_color_aliases" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_color_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_item_aliases_customerId_idx" ON "customer_item_aliases"("customerId");

-- CreateIndex
CREATE INDEX "customer_item_aliases_itemId_idx" ON "customer_item_aliases"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_item_aliases_customerId_itemId_key" ON "customer_item_aliases"("customerId", "itemId");

-- CreateIndex
CREATE INDEX "customer_color_aliases_customerId_idx" ON "customer_color_aliases"("customerId");

-- CreateIndex
CREATE INDEX "customer_color_aliases_colorId_idx" ON "customer_color_aliases"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_color_aliases_customerId_colorId_key" ON "customer_color_aliases"("customerId", "colorId");

-- AddForeignKey
ALTER TABLE "customer_item_aliases" ADD CONSTRAINT "customer_item_aliases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_item_aliases" ADD CONSTRAINT "customer_item_aliases_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_color_aliases" ADD CONSTRAINT "customer_color_aliases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_color_aliases" ADD CONSTRAINT "customer_color_aliases_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
