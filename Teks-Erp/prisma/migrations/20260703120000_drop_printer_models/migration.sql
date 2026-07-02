-- PrinterModel kataloğu kaldırıldı — yazıcı ayarları tamamen cihazın (PeripheralDevice)
-- kendi kolonlarında. Dil zinciri: languageOverride > global ayar (label.printerLanguage);
-- profil zinciri: formatProfileId > sistem-default profil. PrinterLanguage enum'u KALIR.
-- Güvenli sıra: 1) miras verisini cihaza kopyala 2) FK/index/kolon düş 3) tabloyu düş.

-- 1a) Modelden miras alınan dil → cihazın kendi languageOverride'ı
--     (dolu override'lara DOKUNMAZ)
UPDATE "peripheral_devices" pd
SET "languageOverride" = pm."language"
FROM "printer_models" pm
WHERE pd."printerModelId" = pm."id"
  AND pd."languageOverride" IS NULL;

-- 1b) Modelden miras alınan varsayılan profil → cihazın kendi formatProfileId'si
--     (pasif profil kopyalansa bile davranış aynı: resolver pasifi zaten atlıyordu)
UPDATE "peripheral_devices" pd
SET "formatProfileId" = pm."defaultProfileId"
FROM "printer_models" pm
WHERE pd."printerModelId" = pm."id"
  AND pd."formatProfileId" IS NULL
  AND pm."defaultProfileId" IS NOT NULL;

-- 2) peripheral_devices.printerModelId: FK + index + kolon
ALTER TABLE "peripheral_devices" DROP CONSTRAINT "peripheral_devices_printerModelId_fkey";
DROP INDEX "peripheral_devices_printerModelId_idx";
ALTER TABLE "peripheral_devices" DROP COLUMN "printerModelId";

-- 3) Katalog tablosu (kendi index'leri ve label_format_profiles'a FK'sı tabloyla düşer)
DROP TABLE "printer_models";
