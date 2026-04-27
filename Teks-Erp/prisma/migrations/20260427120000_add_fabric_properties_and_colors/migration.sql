-- AlterTable
ALTER TABLE "items" ADD COLUMN     "baseItemId" TEXT,
ADD COLUMN     "colorId" TEXT,
ADD COLUMN     "isDerived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "targetColorId" TEXT;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "targetColorId" TEXT,
ADD COLUMN     "targetColorStepId" TEXT;

-- CreateTable
CREATE TABLE "colors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_properties" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fabric_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_properties" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_colors" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_properties" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_target_properties" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "plannedStepId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_target_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_target_properties" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_line_target_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colors_code_key" ON "colors"("code");

-- CreateIndex
CREATE INDEX "colors_isActive_sortOrder_idx" ON "colors"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_properties_code_key" ON "fabric_properties"("code");

-- CreateIndex
CREATE INDEX "fabric_properties_isActive_sortOrder_idx" ON "fabric_properties"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "fabric_properties_category_idx" ON "fabric_properties"("category");

-- CreateIndex
CREATE INDEX "item_properties_propertyId_idx" ON "item_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "item_properties_itemId_propertyId_key" ON "item_properties"("itemId", "propertyId");

-- CreateIndex
CREATE INDEX "station_colors_colorId_idx" ON "station_colors"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX "station_colors_stationId_colorId_key" ON "station_colors"("stationId", "colorId");

-- CreateIndex
CREATE INDEX "station_properties_propertyId_idx" ON "station_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "station_properties_stationId_propertyId_key" ON "station_properties"("stationId", "propertyId");

-- CreateIndex
CREATE INDEX "work_order_target_properties_propertyId_idx" ON "work_order_target_properties"("propertyId");

-- CreateIndex
CREATE INDEX "work_order_target_properties_plannedStepId_idx" ON "work_order_target_properties"("plannedStepId");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_target_properties_workOrderId_propertyId_key" ON "work_order_target_properties"("workOrderId", "propertyId");

-- CreateIndex
CREATE INDEX "order_line_target_properties_propertyId_idx" ON "order_line_target_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_target_properties_orderLineId_propertyId_key" ON "order_line_target_properties"("orderLineId", "propertyId");

-- CreateIndex
CREATE INDEX "items_baseItemId_idx" ON "items"("baseItemId");

-- CreateIndex
CREATE INDEX "items_colorId_idx" ON "items"("colorId");

-- CreateIndex
CREATE INDEX "items_isDerived_idx" ON "items"("isDerived");

-- CreateIndex
CREATE INDEX "order_lines_targetColorId_idx" ON "order_lines"("targetColorId");

-- CreateIndex
CREATE INDEX "work_orders_targetColorId_idx" ON "work_orders"("targetColorId");

-- CreateIndex
CREATE INDEX "work_orders_targetColorStepId_idx" ON "work_orders"("targetColorStepId");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_baseItemId_fkey" FOREIGN KEY ("baseItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_targetColorId_fkey" FOREIGN KEY ("targetColorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_targetColorId_fkey" FOREIGN KEY ("targetColorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_targetColorStepId_fkey" FOREIGN KEY ("targetColorStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_properties" ADD CONSTRAINT "item_properties_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_properties" ADD CONSTRAINT "item_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_colors" ADD CONSTRAINT "station_colors_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_colors" ADD CONSTRAINT "station_colors_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_properties" ADD CONSTRAINT "station_properties_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_properties" ADD CONSTRAINT "station_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_target_properties" ADD CONSTRAINT "work_order_target_properties_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_target_properties" ADD CONSTRAINT "work_order_target_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_target_properties" ADD CONSTRAINT "work_order_target_properties_plannedStepId_fkey" FOREIGN KEY ("plannedStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_target_properties" ADD CONSTRAINT "order_line_target_properties_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_target_properties" ADD CONSTRAINT "order_line_target_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

