-- =============================================================================
-- DEVERE EK B1 — LEVENT GÖVDESİ ENVANTERİ (2026-11-20)
-- =============================================================================
-- Yalnız EKLEME: iki yeni enum tipi (bu dosyada doğar → CREATE TYPE + kullanım aynı dosyada serbest),
-- üç yeni tablo (gövde kartı · gövde olay defteri · gövde–tezgâh uyum pivotu) ve CHECK'ler. Mevcut tablolara
-- kolon eklenmez; yalnız yeni FK'lar onları işaret eder. Geri alınabilir (tablolar boş doğar).
-- =============================================================================

-- CreateEnum
CREATE TYPE "BeamBodyStatus" AS ENUM ('EMPTY_STOCK', 'AT_SUBCONTRACTOR', 'FULL_STOCK', 'MOUNTED', 'FULL_OUT', 'MAINTENANCE', 'SCRAPPED', 'RETURNED_TO_OWNER');

-- CreateEnum
CREATE TYPE "BeamBodyOwnerRole" AS ENUM ('WARPER', 'CUSTOMER', 'OTHER');

-- CreateTable
CREATE TABLE "beam_bodies" (
    "id" UUID NOT NULL,
    "bodyNo" VARCHAR(32) NOT NULL,
    "clientToken" UUID,
    "ownerCustomerId" UUID,
    "ownerRole" "BeamBodyOwnerRole",
    "widthCm" DECIMAL(8,2),
    "flangeDiameterCm" DECIMAL(8,2),
    "tareKg" DECIMAL(10,3),
    "status" "BeamBodyStatus" NOT NULL DEFAULT 'EMPTY_STOCK',
    "warehouseId" UUID,
    "subcontractorId" UUID,
    "machineId" UUID,
    "notes" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "beam_bodies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beam_body_events" (
    "id" UUID NOT NULL,
    "bodyId" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "fromStatus" "BeamBodyStatus",
    "toStatus" "BeamBodyStatus" NOT NULL,
    "reversesId" UUID,
    "warehouseId" UUID,
    "subcontractorId" UUID,
    "machineId" UUID,
    "warpBeamId" UUID,
    "reasonCode" VARCHAR(64),
    "reason" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beam_body_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beam_body_machines" (
    "bodyId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beam_body_machines_pkey" PRIMARY KEY ("bodyId","machineId")
);

-- CreateIndex
CREATE UNIQUE INDEX "beam_bodies_bodyNo_key" ON "beam_bodies"("bodyNo");

-- CreateIndex
CREATE UNIQUE INDEX "beam_bodies_clientToken_key" ON "beam_bodies"("clientToken");

-- CreateIndex
CREATE INDEX "beam_bodies_status_ownerCustomerId_idx" ON "beam_bodies"("status", "ownerCustomerId");

-- CreateIndex
CREATE INDEX "beam_bodies_ownerCustomerId_idx" ON "beam_bodies"("ownerCustomerId");

-- CreateIndex
CREATE INDEX "beam_bodies_warehouseId_idx" ON "beam_bodies"("warehouseId");

-- CreateIndex
CREATE INDEX "beam_bodies_subcontractorId_idx" ON "beam_bodies"("subcontractorId");

-- CreateIndex
CREATE INDEX "beam_bodies_machineId_idx" ON "beam_bodies"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "beam_body_events_reversesId_key" ON "beam_body_events"("reversesId");

-- CreateIndex
CREATE INDEX "beam_body_events_bodyId_createdAt_idx" ON "beam_body_events"("bodyId", "createdAt");

-- CreateIndex
CREATE INDEX "beam_body_events_kind_createdAt_idx" ON "beam_body_events"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "beam_body_events_warehouseId_idx" ON "beam_body_events"("warehouseId");

-- CreateIndex
CREATE INDEX "beam_body_events_subcontractorId_idx" ON "beam_body_events"("subcontractorId");

-- CreateIndex
CREATE INDEX "beam_body_events_machineId_idx" ON "beam_body_events"("machineId");

-- CreateIndex
CREATE INDEX "beam_body_events_warpBeamId_idx" ON "beam_body_events"("warpBeamId");

-- CreateIndex
CREATE INDEX "beam_body_machines_machineId_idx" ON "beam_body_machines"("machineId");

-- AddForeignKey
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_bodyId_fkey" FOREIGN KEY ("bodyId") REFERENCES "beam_bodies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "beam_body_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_warpBeamId_fkey" FOREIGN KEY ("warpBeamId") REFERENCES "warp_beams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_machines" ADD CONSTRAINT "beam_body_machines_bodyId_fkey" FOREIGN KEY ("bodyId") REFERENCES "beam_bodies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_machines" ADD CONSTRAINT "beam_body_machines_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sahip: NULL = bizim; dolu ise rol dolu (ve tersi).
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_owner_ck"
  CHECK (("ownerCustomerId" IS NULL) = ("ownerRole" IS NULL));

-- Ölçüler pozitif (boş = bilinmiyor).
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_dims_ck"
  CHECK (("widthCm" IS NULL OR "widthCm" > 0) AND ("flangeDiameterCm" IS NULL OR "flangeDiameterCm" > 0) AND ("tareKg" IS NULL OR "tareKg" > 0));

-- Yer ↔ durum: tezgâh yalnız MOUNTED'da ve MOUNTED'da zorunlu; fasoncu yalnız dışarıdaki durumlarda,
-- AT_SUBCONTRACTOR'da zorunlu; depo yalnız bizde duran durumlarda.
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_location_ck"
  CHECK (
    ("machineId" IS NOT NULL) = ("status" = 'MOUNTED')
    AND ("status" <> 'AT_SUBCONTRACTOR' OR "subcontractorId" IS NOT NULL)
    AND ("subcontractorId" IS NULL OR "status" IN ('AT_SUBCONTRACTOR', 'FULL_OUT'))
    AND ("warehouseId" IS NULL OR "status" IN ('EMPTY_STOCK', 'FULL_STOCK', 'MAINTENANCE'))
  );

-- Olay türü evreni (`BEAM_BODY_EVENT_KINDS` ↔ CHECK iki yönlü, `test_levent_govde`).
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_kind_ck"
  CHECK ("kind" IN (
    'REGISTER', 'REGISTER_CANCEL',
    'SHIP_EMPTY', 'SHIP_EMPTY_CANCEL', 'RETURN_EMPTY', 'RETURN_EMPTY_CANCEL',
    'FILLED', 'FILLED_CANCEL', 'MOUNTED', 'MOUNTED_CANCEL', 'EMPTIED', 'EMPTIED_CANCEL',
    'SHIPPED_FULL', 'SHIPPED_FULL_CANCEL', 'MAINTENANCE_IN', 'MAINTENANCE_IN_CANCEL',
    'MAINTENANCE_OUT', 'MAINTENANCE_OUT_CANCEL', 'SCRAP', 'SCRAP_CANCEL',
    'RETURN_TO_OWNER', 'RETURN_TO_OWNER_CANCEL'
  ));

-- Doğuş (REGISTER) önceki durumsuzdur; her öteki olay önceki durumu taşır. Ters kayıt yalnız *_CANCEL'da ve orada zorunlu.
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_from_ck"
  CHECK (("fromStatus" IS NULL) = ("kind" = 'REGISTER'));
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_reverses_ck"
  CHECK (("reversesId" IS NOT NULL) = ("kind" LIKE '%\_CANCEL'));
