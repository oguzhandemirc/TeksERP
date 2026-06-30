-- Cihaz ↔ donanım atama ÇOK-ÇOK (paylaşım). Tekil PeripheralDevice.deviceId yerine
-- join tablosu: bir donanım (ör. ağ yazıcısı) birden çok cihaza atanabilir.
-- (Manuel migration — repo konvansiyonu: psql apply + prisma migrate resolve --applied.)
CREATE TABLE "device_peripherals" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "peripheralId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_peripherals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_peripherals_deviceId_peripheralId_key" ON "device_peripherals"("deviceId", "peripheralId");
CREATE INDEX "device_peripherals_peripheralId_idx" ON "device_peripherals"("peripheralId");
ALTER TABLE "device_peripherals" ADD CONSTRAINT "device_peripherals_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_peripherals" ADD CONSTRAINT "device_peripherals_peripheralId_fkey" FOREIGN KEY ("peripheralId") REFERENCES "peripheral_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mevcut tekil deviceId atamalarını join'e taşı (paylaşım modeline geçiş; veri kaybı yok).
INSERT INTO "device_peripherals" ("id", "deviceId", "peripheralId", "createdAt")
SELECT gen_random_uuid(), "deviceId", "id", CURRENT_TIMESTAMP
FROM "peripheral_devices"
WHERE "deviceId" IS NOT NULL
ON CONFLICT ("deviceId", "peripheralId") DO NOTHING;
