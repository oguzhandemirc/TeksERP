-- CreateEnum
CREATE TYPE "PrinterLanguage" AS ENUM ('RASTER_HTML', 'PPLA', 'PPLB', 'ZPL');

-- CreateEnum
CREATE TYPE "LabelOrientation" AS ENUM ('PORTRAIT', 'LANDSCAPE');

-- CreateTable
CREATE TABLE "label_format_profiles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "widthMm" DECIMAL(6,2) NOT NULL,
    "heightMm" DECIMAL(6,2) NOT NULL,
    "marginMm" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "gapMm" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "dpi" INTEGER NOT NULL DEFAULT 203,
    "orientation" "LabelOrientation" NOT NULL DEFAULT 'PORTRAIT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "label_format_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_models" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "manufacturer" VARCHAR(64),
    "dpi" INTEGER NOT NULL DEFAULT 203,
    "maxWidthMm" INTEGER NOT NULL DEFAULT 104,
    "language" "PrinterLanguage" NOT NULL DEFAULT 'RASTER_HTML',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultProfileId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printer_models_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "machine_hardware" ADD COLUMN "printerModelId" UUID,
ADD COLUMN "formatProfileId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "label_format_profiles_code_key" ON "label_format_profiles"("code");

-- CreateIndex
CREATE INDEX "label_format_profiles_isActive_idx" ON "label_format_profiles"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "printer_models_code_key" ON "printer_models"("code");

-- CreateIndex
CREATE INDEX "printer_models_isActive_idx" ON "printer_models"("isActive");

-- CreateIndex
CREATE INDEX "printer_models_defaultProfileId_idx" ON "printer_models"("defaultProfileId");

-- CreateIndex
CREATE INDEX "machine_hardware_printerModelId_idx" ON "machine_hardware"("printerModelId");

-- CreateIndex
CREATE INDEX "machine_hardware_formatProfileId_idx" ON "machine_hardware"("formatProfileId");

-- AddForeignKey
ALTER TABLE "printer_models" ADD CONSTRAINT "printer_models_defaultProfileId_fkey" FOREIGN KEY ("defaultProfileId") REFERENCES "label_format_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_hardware" ADD CONSTRAINT "machine_hardware_printerModelId_fkey" FOREIGN KEY ("printerModelId") REFERENCES "printer_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_hardware" ADD CONSTRAINT "machine_hardware_formatProfileId_fkey" FOREIGN KEY ("formatProfileId") REFERENCES "label_format_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
