-- H1 (Hizmet veren, 2026-10-29): kurşun metre defteri (RollMeterReading) + sapma onayı (RollMeterAck)
-- + sayaç cihaz alanları. --create-only; DropForeignKey satırları silindi. Aktif-tekil unique'ler PARTIAL.
-- CreateEnum
CREATE TYPE "MeterPhase" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MeterCounterMode" AS ENUM ('RESETTING', 'CUMULATIVE');

-- CreateEnum
CREATE TYPE "MeterVarianceBasis" AS ENUM ('DECLARED_IN', 'MEASURED_IN');

-- CreateEnum
CREATE TYPE "MeterApprovalMode" AS ENUM ('NONE', 'OPERATOR_REASON', 'SUPERVISOR_PIN', 'OFFICE');

-- AlterTable
ALTER TABLE "peripheral_devices" ADD COLUMN     "counterMode" "MeterCounterMode",
ADD COLUMN     "resetCommand" VARCHAR(64);

-- CreateTable
CREATE TABLE "roll_meter_readings" (
    "id" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "workOrderStepId" UUID NOT NULL,
    "phase" "MeterPhase" NOT NULL,
    "meters" DECIMAL(12,3) NOT NULL,
    "rawCounter" DECIMAL(14,3),
    "source" "MachineDataSource" NOT NULL,
    "machineId" UUID,
    "peripheralId" UUID,
    "cardSampleId" UUID,
    "thresholdM" DECIMAL(12,3),
    "thresholdPct" DECIMAL(6,3),
    "basis" "MeterVarianceBasis" NOT NULL,
    "approvalMode" "MeterApprovalMode" NOT NULL,
    "clientToken" UUID NOT NULL,
    "createdById" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roll_meter_acks" (
    "id" UUID NOT NULL,
    "readingId" UUID NOT NULL,
    "mode" "MeterApprovalMode" NOT NULL,
    "reasonCode" VARCHAR(64),
    "reasonText" VARCHAR(300),
    "approvedById" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_meter_acks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roll_meter_readings_clientToken_key" ON "roll_meter_readings"("clientToken");

-- CreateIndex
CREATE INDEX "roll_meter_readings_workOrderStepId_createdAt_idx" ON "roll_meter_readings"("workOrderStepId", "createdAt");

-- CreateIndex
CREATE INDEX "roll_meter_readings_machineId_idx" ON "roll_meter_readings"("machineId");

-- CreateIndex
CREATE INDEX "roll_meter_readings_peripheralId_idx" ON "roll_meter_readings"("peripheralId");

-- CreateIndex
CREATE INDEX "roll_meter_readings_createdById_idx" ON "roll_meter_readings"("createdById");

-- CreateIndex
-- PARTIAL: damgalı okuma dururken aynı (top, adım, evre) yeniden yazılabilsin (RollOperation emsali).
CREATE UNIQUE INDEX "roll_meter_readings_active_uq" ON "roll_meter_readings"("rollId", "workOrderStepId", "phase") WHERE "revokedAt" IS NULL;

-- Aktif okuma sorgusu (top bazlı).
CREATE INDEX "roll_meter_readings_roll_revoked_idx" ON "roll_meter_readings"("rollId", "revokedAt");

-- CreateIndex
CREATE INDEX "roll_meter_acks_approvedById_idx" ON "roll_meter_acks"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "roll_meter_acks_active_uq" ON "roll_meter_acks"("readingId") WHERE "revokedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_workOrderStepId_fkey" FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_peripheralId_fkey" FOREIGN KEY ("peripheralId") REFERENCES "peripheral_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_meter_acks" ADD CONSTRAINT "roll_meter_acks_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "roll_meter_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_meter_acks" ADD CONSTRAINT "roll_meter_acks_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Metre negatif olamaz; damga üçlüsü birlikte dolar.
ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_meters_ck" CHECK ("meters" >= 0);
ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_revoke_ck" CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL));
ALTER TABLE "roll_meter_acks" ADD CONSTRAINT "roll_meter_acks_revoke_ck" CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL));
