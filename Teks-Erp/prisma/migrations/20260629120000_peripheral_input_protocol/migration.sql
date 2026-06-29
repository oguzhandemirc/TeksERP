-- PeripheralDevice: SCALE/METER giriş-cihazı okuma protokolü alanları (additive, nullable).
ALTER TABLE "peripheral_devices"
  ADD COLUMN "pollCommand" VARCHAR(64),
  ADD COLUMN "terminator"  VARCHAR(8),
  ADD COLUMN "decimals"    INTEGER,
  ADD COLUMN "scale"       DECIMAL(10,4),
  ADD COLUMN "unit"        VARCHAR(8),
  ADD COLUMN "timeoutMs"   INTEGER,
  ADD COLUMN "role"        VARCHAR(24),
  ADD COLUMN "simulate"    BOOLEAN NOT NULL DEFAULT false;
