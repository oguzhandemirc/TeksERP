-- H6: işlem (FLAG özellik) ya da gramaj kademesi (çeşit değeri) → hizmet kalemi eşlemesi.
-- Önce değer, sonra özellik okunur (resolveServiceItemsForRolls). FK RESTRICT: eşlenmiş
-- hizmet kalemi silinemez. Boş kolon = bugünkü davranış (hizmet faturalaması yok).

-- AlterTable
ALTER TABLE "fabric_properties" ADD COLUMN "serviceItemId" UUID;

-- AlterTable
ALTER TABLE "fabric_property_values" ADD COLUMN "serviceItemId" UUID;

-- CreateIndex
CREATE INDEX "fabric_properties_serviceItemId_idx" ON "fabric_properties"("serviceItemId");

-- CreateIndex
CREATE INDEX "fabric_property_values_serviceItemId_idx" ON "fabric_property_values"("serviceItemId");

-- AddForeignKey
ALTER TABLE "fabric_properties" ADD CONSTRAINT "fabric_properties_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_property_values" ADD CONSTRAINT "fabric_property_values_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
