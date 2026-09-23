-- BİÇİM SATIRININ KÖKENİ — kayıt mı, göç tahmini mi? (2026-09-23)
-- YALNIZ EKLER: bir enum + bir kolon. Varsayılan `RECORDED`.
--
-- ⚠️ TEK VERİ DÜZELTMESİ VAR ve gerekçesi şu: D4①'in göçü (boot işinde) zaten
-- koşmuş olabilir ve o satırlarda köken bilgisi YOK. Göçün `retiredPrefixes`ten
-- ürettiği EMEKLİ satırların biçimi bir TAHMİNDİR (eski segment/hane hiçbir
-- yerde yazılı değildi); onları `MIGRATED_GUESS` olarak işaretliyoruz.
-- Ölçüt "sentinel" DEĞİL, "aynı seride daha yeni bir satır VAR": yürürlükteki
-- satırın tarihi de sentinel olabilir ama BİÇİMİ tahmin değildir.
-- İdempotent: ikinci koşumda `WHERE origin = 'RECORDED'` zaten eşleşmez.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NumberSeriesLineOrigin') THEN
    CREATE TYPE "NumberSeriesLineOrigin" AS ENUM ('RECORDED', 'MIGRATED_GUESS');
  END IF;
END $$;

ALTER TABLE "number_series_lines"
  ADD COLUMN IF NOT EXISTS "origin" "NumberSeriesLineOrigin" NOT NULL DEFAULT 'RECORDED';

UPDATE "number_series_lines" l
   SET "origin" = 'MIGRATED_GUESS'
 WHERE l."origin" = 'RECORDED'
   AND EXISTS (
     SELECT 1 FROM "number_series_lines" y
      WHERE y."seriesKey" = l."seriesKey"
        AND y."effectiveFrom" > l."effectiveFrom"
   );
