-- NOT: Prisma'nın ürettiği iki `DropForeignKey` satırı BİLİNÇLİ olarak silindi
-- (DEFERRABLE composite FK'lar datamodel'de temsil edilemiyor). Bkz. CLAUDE.md
-- "sacks composite FK drift'i".

-- AlterTable
ALTER TABLE "roll_properties" ADD COLUMN     "valueId" UUID;

-- CreateIndex
CREATE INDEX "roll_properties_valueId_idx" ON "roll_properties"("valueId");

-- AddForeignKey
ALTER TABLE "roll_properties" ADD CONSTRAINT "roll_properties_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
