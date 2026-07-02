-- Çalışma Oturumu (WorkSession) çekirdeği: work_sessions tablosu + istasyona-bağlı
-- donanım (peripheral_devices.stationId) + KK1 makine atfı (rolls.createdMachineId).
-- (Manuel migration — repo konvansiyonu: psql apply + prisma migrate resolve --applied.)
-- NOT: 'SHIPPING' enum değeri bir ÖNCEKİ migration'da (20260702120000) eklendi —
-- ALTER TYPE ADD VALUE, değeri kullanan statement'la aynı tx'te olamaz (PG 55P04).

-- Mevcut kurulumlarda sevkiyat istasyonunu yeni türe çek (yeni seed ile aynı sonuç).
UPDATE "stations" SET "kind" = 'SHIPPING' WHERE "code" = 'SEVK_1' AND "kind" = 'OTHER';

CREATE TYPE "WorkSessionEndReason" AS ENUM ('LOGOUT', 'NEW_LOGIN', 'TAKEOVER', 'IDLE', 'ADMIN');

CREATE TABLE "work_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "machineId" UUID,
    "stationId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "WorkSessionEndReason",
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_sessions_userId_startedAt_idx" ON "work_sessions"("userId", "startedAt");
CREATE INDEX "work_sessions_machineId_startedAt_idx" ON "work_sessions"("machineId", "startedAt");
CREATE INDEX "work_sessions_stationId_startedAt_idx" ON "work_sessions"("stationId", "startedAt");
CREATE INDEX "work_sessions_deviceId_startedAt_idx" ON "work_sessions"("deviceId", "startedAt");
CREATE INDEX "work_sessions_endedAt_idx" ON "work_sessions"("endedAt");

-- İnvariant seddi (ŞEMA-DIŞI partial unique — schema.prisma model yorumunda belgeli):
-- bir MAKİNEDE tek aktif oturum + bir CİHAZDA tek aktif oturum. Eşzamanlı open
-- yarışının kaybedeni P2002 alır (servis 409 Türkçe mesaja çevirir).
CREATE UNIQUE INDEX "work_sessions_active_machine_uq" ON "work_sessions"("machineId") WHERE "endedAt" IS NULL AND "machineId" IS NOT NULL;
CREATE UNIQUE INDEX "work_sessions_active_device_uq" ON "work_sessions"("deviceId") WHERE "endedAt" IS NULL;

-- Ayak izi tarihçesi korunur — taraflar silinirken geçmiş oturum kaybolmaz (Restrict).
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MAKİNESİZ istasyona sabit donanım (sevkiyat çuval kantarı vb.) — makineli istasyona
-- doğrudan bağlama serviste reddedilir (yan yana özdeş HC-06 belirsizliği makine bağı ister).
ALTER TABLE "peripheral_devices" ADD COLUMN "stationId" UUID;
ALTER TABLE "peripheral_devices" ADD CONSTRAINT "peripheral_devices_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "peripheral_devices_stationId_idx" ON "peripheral_devices"("stationId");

-- Mevcut kurulumda sevkiyat kantarını makineden istasyona taşı (SEVK-M1 emekli oluyor;
-- makine kaydı duruyorsa da kantar artık istasyon üzerinden çözülür).
UPDATE "peripheral_devices" p
SET "stationId" = m."stationId", "machineId" = NULL
FROM "machines" m
WHERE p."machineId" = m."id" AND m."code" = 'SEVK-M1';

-- SEVK-M1 emekli (soft): sevkiyat MAKİNESİZ istasyon oldu — aktif makinesi kalsaydı
-- "makineli istasyonda istasyon-oturumu açılamaz" kuralı SEVK_1'i kilitlerdi.
UPDATE "machines" SET "isActive" = false WHERE "code" = 'SEVK-M1';

-- KK1 girişinde topun oluşturulduğu makine (aktif oturumdan damgalanır — Faz 2).
ALTER TABLE "rolls" ADD COLUMN "createdMachineId" UUID;
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_createdMachineId_fkey" FOREIGN KEY ("createdMachineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "rolls_createdMachineId_idx" ON "rolls"("createdMachineId");
