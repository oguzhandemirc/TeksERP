-- NUMBER SERIES — NUMARA KAYNAĞI: sistem / elle / serbest (2026-09-23)
-- YALNIZ EKLER (ADDITIVE): bir enum + bir kolon. Hiçbir satır güncellenmez.
--
-- ⚠️ VARSAYILAN 'FREE' ve bu ÖLÇÜLMÜŞ bir karar: bugünkü davranış "sistem üretir
-- AMA elle gelen değeri de kabul eder"dir. İki değerli bir ayar (sistem/elle)
-- bunu İFADE EDEMEZDİ ve "yeni ayarın varsayılanı = bugünkü davranış" cümlesi
-- ölçülemez hâle gelirdi.
--
-- ⚠️ Ayar yalnız ELLE YOLU OLAN dört seride anlamlı (çuval · iş emri · sipariş ·
-- sevk partisi adı); kalan 48'de kabul yolunun kendisi YOK. Bu sınır katalogda
-- `manualEntry` ile beyanlı ve uçta 400 ile korunuyor — kolon hepsinde durur
-- ama yalnız beyanlı serilerde yazılabilir.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NumberSourceMode') THEN
    CREATE TYPE "NumberSourceMode" AS ENUM ('FREE', 'SYSTEM', 'MANUAL');
  END IF;
END $$;

ALTER TABLE "number_series"
  ADD COLUMN IF NOT EXISTS "numberSource" "NumberSourceMode" NOT NULL DEFAULT 'FREE';
