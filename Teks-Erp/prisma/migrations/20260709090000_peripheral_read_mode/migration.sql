-- Cihaz okuma davranışı VERİ olarak modellenir: POLL (sor-cevap, komut yolla) /
-- STREAM (cihaz sürekli yayınlar, dinle). Tambur metresi=POLL, Sevkiyat kantarı=STREAM.
-- Küçük tablo + sabit-default kolon → metadata-only, kilit riski yok.
CREATE TYPE "PeripheralReadMode" AS ENUM ('POLL', 'STREAM');

ALTER TABLE "peripheral_devices"
  ADD COLUMN "readMode" "PeripheralReadMode" NOT NULL DEFAULT 'POLL';
