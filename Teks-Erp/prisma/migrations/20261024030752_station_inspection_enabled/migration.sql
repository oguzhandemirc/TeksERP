-- İstasyon MUAYENE yeteneği (KQ-D1, 2026-10-24)
--
-- "Bu istasyonda hata kaydı (kalite paneli) açılır mı?" sorusu artık
-- istasyonun KENDİ alanı. Akış sorusu (`stepRunsStepFlow`: PROCESS_QC ∨
-- appliesQuality) DEĞİŞMEZ; bu kolon ona katılmaz.
--
-- ÖLÇÜMSÜZ TÜRETME (KARAR K2): fabrika verisine bakılmadan, bugünkü ETKİN
-- davranıştan SQL ile türetilir. Bekçi `test_station_quality_capability §7`
-- aşağıdaki UPDATE ifadesini BU DOSYADAN okuyup `inspectionDefaultForKind`
-- doğruluk tablosuyla karşılaştırır — ifadeyi değiştiren bekçiyi de değiştirir.

-- AlterTable
ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "inspectionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- BUGÜNKÜ ETKİN davranış: hata kaydını fiilen açan iki ekran ailesi (KK2: PROCESS_QC, Tambur: TAMBUR).
-- KK1 (RAW_QC) bugün RollError YAZMAZ; OTHER vb. + appliesQuality=true bugün çıkışsız kapıdır → false.
-- ⚠️ Seed'i KURTARMAZ (seed migration'dan SONRA boş tabloda koşar): seed.ts AÇIK yazar.
UPDATE "stations" SET "inspectionEnabled" = ("kind" IN ('PROCESS_QC','TAMBUR'))
 WHERE "inspectionEnabled" IS DISTINCT FROM ("kind" IN ('PROCESS_QC','TAMBUR'));
