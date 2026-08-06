-- ⚠️ `migrate dev` bu diff'e iki DropForeignKey satırı daha yazmıştı
-- (`rolls_sackId_shipmentId_consistency_fkey` + swatches ikizi). Bunlar
-- datamodel'de temsil edilemeyen DEFERRABLE composite FK'lardır ve HER diff'te
-- yeniden düşürülmek istenir — bilinçli olarak silindi (bkz. schema.prisma:2557).

-- AlterTable
ALTER TABLE "route_steps" ADD COLUMN     "plannedColorId" UUID;

-- CreateTable
CREATE TABLE "route_step_properties" (
    "id" UUID NOT NULL,
    "routeStepId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_step_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_step_properties_propertyId_idx" ON "route_step_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "route_step_properties_routeStepId_propertyId_key" ON "route_step_properties"("routeStepId", "propertyId");

-- CreateIndex
CREATE INDEX "route_steps_plannedColorId_idx" ON "route_steps"("plannedColorId");

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_plannedColorId_fkey" FOREIGN KEY ("plannedColorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_step_properties" ADD CONSTRAINT "route_step_properties_routeStepId_fkey" FOREIGN KEY ("routeStepId") REFERENCES "route_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_step_properties" ADD CONSTRAINT "route_step_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
