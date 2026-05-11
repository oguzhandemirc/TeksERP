-- =============================================================================
-- Add WorkOrderTargetProperty (basit, step planlaması yok) + RollProperty
-- =============================================================================
-- Item kimliği = (baseItem, color). Özellikler kimliği etkilemez.
-- Planlamacı WO'da targetProperties seçer, Tambur finalize'da Roll'a bindirilir.
-- ItemProperty modeli (item_properties tablosu) korundu — anlamı "allowed
-- properties"e dönüştürüldü; tablo yapısı aynı, migration gerektirmez.
-- =============================================================================

-- CreateTable
CREATE TABLE "work_order_target_properties" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_order_target_properties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "roll_properties" (
    "id" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roll_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_order_target_properties_propertyId_idx" ON "work_order_target_properties"("propertyId");
CREATE UNIQUE INDEX "work_order_target_properties_workOrderId_propertyId_key" ON "work_order_target_properties"("workOrderId", "propertyId");

CREATE INDEX "roll_properties_propertyId_idx" ON "roll_properties"("propertyId");
CREATE UNIQUE INDEX "roll_properties_rollId_propertyId_key" ON "roll_properties"("rollId", "propertyId");

-- AddForeignKey
ALTER TABLE "work_order_target_properties" ADD CONSTRAINT "work_order_target_properties_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_target_properties" ADD CONSTRAINT "work_order_target_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roll_properties" ADD CONSTRAINT "roll_properties_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "roll_properties" ADD CONSTRAINT "roll_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
