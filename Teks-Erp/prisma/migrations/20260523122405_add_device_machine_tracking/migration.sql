-- AlterTable
ALTER TABLE "roll_movements" ADD COLUMN     "machineId" TEXT;

-- AlterTable
ALTER TABLE "roll_operations" ADD COLUMN     "machineId" TEXT;

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "machineId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "code" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_deviceId_key" ON "devices"("deviceId");

-- CreateIndex
CREATE INDEX "devices_machineId_idx" ON "devices"("machineId");

-- CreateIndex
CREATE INDEX "pairing_codes_machineId_idx" ON "pairing_codes"("machineId");

-- CreateIndex
CREATE INDEX "pairing_codes_expiresAt_idx" ON "pairing_codes"("expiresAt");

-- CreateIndex
CREATE INDEX "roll_movements_machineId_idx" ON "roll_movements"("machineId");

-- CreateIndex
CREATE INDEX "roll_operations_machineId_idx" ON "roll_operations"("machineId");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
