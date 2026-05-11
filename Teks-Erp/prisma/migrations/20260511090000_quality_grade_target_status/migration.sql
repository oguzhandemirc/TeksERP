-- QualityGrade kataloğuna targetStatus alanı ekle. Tambur'da bu kalite
-- seçildiğinde çocuk top'un RollStatus'unu bu alan belirler. Daha önce
-- backend'de sabit code string'leriyle eşleştirme yapılıyordu; admin
-- panelinden auto-generated kodlu (KAL-YYMM-XXXX) kalite eklenince
-- eşleşme başarısız olup tüm CUT'lar SCRAP'e düşüyordu.

ALTER TABLE "quality_grades"
  ADD COLUMN "targetStatus" "RollStatus" NOT NULL DEFAULT 'SCRAP';

-- Mevcut kayıtları isim/kod örüntüsüne göre doğru status'a backfill et.
-- ILIKE ASCII bazlı case-insensitive; Türkçe İ/ı için açık varyantları
-- ekliyoruz. Bilinmeyen isimler SCRAP'te kalır — admin sonradan düzeltir.

-- PostgreSQL default locale Türkçe İ/ı'yı doğru lowercase'lemiyor
-- (lower('FİRE') = 'fİre'). Bu yüzden ILIKE pattern'lerine her iki
-- harf varyantını (Türkçe İ + ASCII I) açıkça yazıyoruz.

-- 1) Birinci kalite → WAREHOUSE
UPDATE "quality_grades"
SET "targetStatus" = 'WAREHOUSE'
WHERE
  "name" ILIKE '%1. sınıf%'
  OR "name" ILIKE '%1.sınıf%'
  OR "name" ILIKE '%1. sinif%'
  OR "name" ILIKE '%1.sinif%'
  OR "name" ILIKE '%1. sInIf%'
  OR "name" ILIKE '%1. kalite%'
  OR "name" ILIKE '%1.kalite%'
  OR "name" ILIKE '%birinci%'
  OR "name" ILIKE '%bİrİncİ%'
  OR upper("code") = '1.KALITE';

-- 2) Alt kalite satılabilir stok → A1_STOCK
UPDATE "quality_grades"
SET "targetStatus" = 'A1_STOCK'
WHERE "targetStatus" = 'SCRAP'
  AND (
    "name" ILIKE '%A1%'
    OR "name" ILIKE '%A2%'
    OR "name" ILIKE '%2. kalite%'
    OR "name" ILIKE '%2.kalite%'
    OR "name" ILIKE '%2. sınıf%'
    OR "name" ILIKE '%2.sınıf%'
    OR "name" ILIKE '%2. sinif%'
    OR "name" ILIKE '%2.sinif%'
    OR upper("code") IN ('A1', 'A2', '2.KALITE', 'A1-2.KALITE')
  );

-- 3) FİRE / FIRE → SCRAP (default zaten ama açıkça belirt)
UPDATE "quality_grades"
SET "targetStatus" = 'SCRAP'
WHERE
  "name" ILIKE '%fire%'
  OR "name" ILIKE '%fİre%'
  OR upper("code") = 'FIRE';
