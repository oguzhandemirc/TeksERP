-- CreateTable
CREATE TABLE "machine_hardware" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "printerIp" VARCHAR(64),
    "printerMac" VARCHAR(32),
    "kqMac" VARCHAR(32),
    "mtMac" VARCHAR(32),
    "mtMac2" VARCHAR(32),
    "kqPattern" VARCHAR(255),
    "mtPattern" VARCHAR(255),
    "mtPattern2" VARCHAR(255),
    "notes" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_hardware_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "machine_hardware_machineId_key" ON "machine_hardware"("machineId");

-- AddForeignKey
ALTER TABLE "machine_hardware" ADD CONSTRAINT "machine_hardware_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

