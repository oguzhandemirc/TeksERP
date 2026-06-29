-- Birleşik cihaz kaydı (PeripheralDevice) + per-kind şablon yönlendirme
-- (PeripheralTemplateRoute) + ConnectionType / PeripheralKind enumları.
-- Yalnız bu özelliğe ait; mevcut dal drift'i (order_lines/roll_errors/sacks vb.)
-- KASTEN dahil DEĞİL — onlar ayrı/ilgisiz WIP.

-- CreateEnum
CREATE TYPE "ConnectionType" AS ENUM ('NETWORK_TCP', 'BLUETOOTH_SPP', 'BLE', 'USB', 'SERIAL_COM');

-- CreateEnum
CREATE TYPE "PeripheralKind" AS ENUM ('LABEL_PRINTER', 'SCALE', 'METER', 'SIGNAL_SOURCE');

-- CreateTable
CREATE TABLE "peripheral_devices" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "PeripheralKind" NOT NULL,
    "connectionType" "ConnectionType" NOT NULL,
    "address" VARCHAR(128),
    "port" INTEGER,
    "identifyPattern" VARCHAR(255),
    "machineId" UUID,
    "deviceId" UUID,
    "printerModelId" UUID,
    "formatProfileId" UUID,
    "languageOverride" "PrinterLanguage",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "peripheral_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peripheral_template_routes" (
    "id" UUID NOT NULL,
    "peripheralId" UUID NOT NULL,
    "kind" "LabelKind" NOT NULL,
    "templateId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "peripheral_template_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "peripheral_devices_code_key" ON "peripheral_devices"("code");

-- CreateIndex
CREATE INDEX "peripheral_devices_machineId_idx" ON "peripheral_devices"("machineId");

-- CreateIndex
CREATE INDEX "peripheral_devices_deviceId_idx" ON "peripheral_devices"("deviceId");

-- CreateIndex
CREATE INDEX "peripheral_devices_printerModelId_idx" ON "peripheral_devices"("printerModelId");

-- CreateIndex
CREATE INDEX "peripheral_devices_formatProfileId_idx" ON "peripheral_devices"("formatProfileId");

-- CreateIndex
CREATE INDEX "peripheral_devices_connectionType_idx" ON "peripheral_devices"("connectionType");

-- CreateIndex
CREATE INDEX "peripheral_devices_isActive_idx" ON "peripheral_devices"("isActive");

-- CreateIndex
CREATE INDEX "peripheral_template_routes_templateId_idx" ON "peripheral_template_routes"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "peripheral_template_routes_peripheralId_kind_key" ON "peripheral_template_routes"("peripheralId", "kind");

-- AddForeignKey
ALTER TABLE "peripheral_devices" ADD CONSTRAINT "peripheral_devices_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peripheral_devices" ADD CONSTRAINT "peripheral_devices_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peripheral_devices" ADD CONSTRAINT "peripheral_devices_printerModelId_fkey" FOREIGN KEY ("printerModelId") REFERENCES "printer_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peripheral_devices" ADD CONSTRAINT "peripheral_devices_formatProfileId_fkey" FOREIGN KEY ("formatProfileId") REFERENCES "label_format_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peripheral_template_routes" ADD CONSTRAINT "peripheral_template_routes_peripheralId_fkey" FOREIGN KEY ("peripheralId") REFERENCES "peripheral_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peripheral_template_routes" ADD CONSTRAINT "peripheral_template_routes_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "label_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
