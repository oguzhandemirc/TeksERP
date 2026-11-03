-- K22 (2026-11-03): istasyon yeteneğine "varsayılan açık" + isteğe bağlı "varsayılan değer".
-- Varsayılan false / NULL = bugünkü davranış (ön seçim yok). Değer silinemez (RESTRICT) — önce yetenekten kaldırılır.

-- AlterTable
ALTER TABLE "station_properties" ADD COLUMN     "defaultOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultValueId" UUID;

-- CreateIndex
CREATE INDEX "station_properties_defaultValueId_idx" ON "station_properties"("defaultValueId");

-- AddForeignKey
ALTER TABLE "station_properties" ADD CONSTRAINT "station_properties_defaultValueId_fkey" FOREIGN KEY ("defaultValueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
