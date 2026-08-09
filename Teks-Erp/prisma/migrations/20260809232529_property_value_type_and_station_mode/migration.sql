-- CreateEnum
CREATE TYPE "FabricPropertyValueType" AS ENUM ('FLAG', 'CHOICE');

-- CreateEnum
CREATE TYPE "StationPropertyMode" AS ENUM ('AUTO', 'OPTIONAL', 'REQUIRED');

-- NOT: Prisma'nın ürettiği iki `DropForeignKey` satırı BİLİNÇLİ olarak silindi
-- (`rolls_sackId_shipmentId_consistency_fkey` + `swatches_...`). Bu DEFERRABLE
-- composite FK'lar datamodel'de temsil edilemiyor, bu yüzden `migrate dev` her
-- diff'te onları düşürmek istiyor. Bkz. schema.prisma → sacks notu ve
-- CLAUDE.md "sacks composite FK drift'i".

-- AlterTable
ALTER TABLE "fabric_properties" ADD COLUMN     "valueType" "FabricPropertyValueType" NOT NULL DEFAULT 'FLAG';

-- AlterTable
ALTER TABLE "station_properties" ADD COLUMN     "mode" "StationPropertyMode" NOT NULL DEFAULT 'OPTIONAL';

-- CreateTable
CREATE TABLE "fabric_property_values" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fabric_property_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fabric_property_values_propertyId_sortOrder_idx" ON "fabric_property_values"("propertyId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_property_values_propertyId_code_key" ON "fabric_property_values"("propertyId", "code");

-- AddForeignKey
ALTER TABLE "fabric_property_values" ADD CONSTRAINT "fabric_property_values_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
