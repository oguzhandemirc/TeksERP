-- B5 (D4-SEMA; B-3 kullanıcı kararı 2026-10-31): ölçü cihazı (METER) kalibrasyon kaydı İSTEĞE BAĞLI.
-- NULL = kayıt yok ⇒ mevcut cihazlar bugünkü gibi; kontrol ayarı system_settings'te (migration'sız, varsayılan kapalı).
-- ADDITIVE: üç nullable kolon + CHECK; toplu UPDATE yok.

ALTER TABLE "peripheral_devices" ADD COLUMN IF NOT EXISTS "calibratedAt" TIMESTAMPTZ;
ALTER TABLE "peripheral_devices" ADD COLUMN IF NOT EXISTS "calibrationDueAt" TIMESTAMPTZ;
ALTER TABLE "peripheral_devices" ADD COLUMN IF NOT EXISTS "calibrationNote" VARCHAR(200);

DO $ck$ BEGIN
  -- Geçerlilik sonu kalibrasyondan önce olamaz (ikisi de doluysa).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'peripheral_devices_calibration_ck') THEN
    ALTER TABLE "peripheral_devices" ADD CONSTRAINT "peripheral_devices_calibration_ck" CHECK (
      "calibratedAt" IS NULL OR "calibrationDueAt" IS NULL OR "calibrationDueAt" >= "calibratedAt"
    );
  END IF;
END $ck$;
