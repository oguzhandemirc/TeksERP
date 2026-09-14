-- =============================================================================
-- PeripheralDevice.unit DÜŞER — çakılı varsayım ③ (2026-09-12 kullanıcı onayı)
-- =============================================================================
-- Kolon SÜS alandı: hiçbir okuyucu yoktu, çarpan yalnız `scale` (Electron
-- "Cihazın ham birimi" seçicisi ölçeği yazar, ölçekten geri çözer). Eski istemci
-- (1.3.1 panel) `unit` göndermeye devam eder: `peripheral.service` create/update
-- `delete data.unit` toleransı ve `sanitizeWriteData` DMMF süzgeci onu düşürür.
-- Veri kaybı: yalnız süs metin ("m"/"kg"), iş kararına girmiyordu. İdempotent.
ALTER TABLE "peripheral_devices" DROP COLUMN IF EXISTS "unit";
