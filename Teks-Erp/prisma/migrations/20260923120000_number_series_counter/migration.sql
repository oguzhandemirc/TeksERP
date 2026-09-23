-- NUMBER SERIES — SAYAÇ AYARLARI: başlangıç · adım · üst sınır (2026-09-23)
-- YALNIZ EKLER (ADDITIVE): üç nullable kolon + üç CHECK. Hiçbir satır
-- güncellenmez, hiçbir kolon düşmez, üretim yoluna DOKUNMAZ.
--
-- ⚠️ NULL = BUGÜNKÜ DAVRANIŞ ve bu bilinçli: başlangıç 1, adım 1, üst sınır yok.
-- Varsayılan DEĞER yazmak (ör. step DEFAULT 1) "ayar verildi mi verilmedi mi"
-- sorusunu cevapsız bırakırdı; panel "ayarlanmamış" ile "1'e ayarlanmış"ı ayırt
-- etmeli ki kullanıcıya boş kutu gösterebilsin.
--
-- ⚠️ CHECK'ler uygulama kapısının DB İKİZİDİR (çift yüklem): kapı 400 döner, sed
-- bozuk satırı hiç yazdırmaz. `maxValue >= startValue` yalnız İKİSİ DE doluyken
-- aranır — NULL'lı karşılaştırma UNKNOWN döndürür ve CHECK UNKNOWN'ı GEÇİRİR,
-- yani tek taraflı ayar serbest kalır (istenen davranış).
--
-- ⚠️ `digits` KAPASİTE DEĞİL: 4 hane + sıra 10000 → "10000" (ölçüldü, sarmaz).
-- Bu yüzden `maxValue` ile `digits` arasında bir CHECK YOKTUR; sayacı durduran
-- tek şey `maxValue`dur.

ALTER TABLE "number_series" ADD COLUMN IF NOT EXISTS "startValue" INTEGER;
ALTER TABLE "number_series" ADD COLUMN IF NOT EXISTS "step" INTEGER;
ALTER TABLE "number_series" ADD COLUMN IF NOT EXISTS "maxValue" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_series_start_value_positive') THEN
    ALTER TABLE "number_series" ADD CONSTRAINT "number_series_start_value_positive"
      CHECK ("startValue" IS NULL OR "startValue" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_series_step_positive') THEN
    ALTER TABLE "number_series" ADD CONSTRAINT "number_series_step_positive"
      CHECK ("step" IS NULL OR "step" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_series_max_value_range') THEN
    ALTER TABLE "number_series" ADD CONSTRAINT "number_series_max_value_range"
      CHECK ("maxValue" IS NULL OR ("maxValue" >= 1 AND ("startValue" IS NULL OR "maxValue" >= "startValue")));
  END IF;
END $$;
