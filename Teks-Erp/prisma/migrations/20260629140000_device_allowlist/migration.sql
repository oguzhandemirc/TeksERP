-- Tablet kimliği: PairingCode (6-haneli kod) emekli → allowlist + atama (Device.status).
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'APPROVED');

ALTER TABLE "devices" ADD COLUMN "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING';

-- Mevcut atanmış (machineId dolu) cihazlar zaten çalışıyordu → APPROVED (atıf korunur).
UPDATE "devices" SET "status" = 'APPROVED' WHERE "machineId" IS NOT NULL;

CREATE INDEX "devices_status_idx" ON "devices" ("status");

DROP TABLE IF EXISTS "pairing_codes";
