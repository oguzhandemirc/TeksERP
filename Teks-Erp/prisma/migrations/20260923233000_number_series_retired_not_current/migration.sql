-- YÜRÜRLÜKTEKİ ÖN EK EMEKLİ LİSTEDE OLAMAZ (K7, 2026-09-23)
--
-- ÖLÇÜLDÜ (d3'ün gerçek panel turu, `tekserp_d3e2e_test`): bir ön eki deneyip
-- GERİ ALMAK, eski değeri emekli listede BIRAKIYORDU — `packingLotCode` satırı
-- `prefix=PRT`, `retiredPrefixes={PRT,ZQ}` hâline geldi. İki zararı var:
--   ① Emekli liste "eskiden bu ön ek kullanılıyordu" DİYE OKUNUR; yürürlükteki
--      ön ekin orada durması bu cümleyi yalanlar.
--   ② Tarama uzayındaki çakışma kapısı hem `prefix`e hem emekli listeye bakar;
--      aynı değerin ikisinde birden durması kapıyı KENDİ KENDİNE çakıştırmaya
--      yaklaştırır (bugün `other.key === key` ile kurtuluyor, yani koruma
--      tesadüfi).
--
-- Sed uygulama kapısının DB İKİZİDİR (çift yüklem): tek yazar
-- (`updateSeriesFormat`) artık yeni ön eki listeden düşürüyor, bu CHECK de
-- bozuk satırın hiç yazılmamasını garanti ediyor.
--
-- ⚠️ ÖNCE VERİ, SONRA SED: CHECK'i kirli bir veritabanına eklemek migration'ı
-- 23514 ile düşürür ve FAILED bırakır. `array_remove` idempotenttir ve BİLGİ
-- KAYBETMEZ: silinen değer satırın kendi `prefix` kolonunda zaten duruyor.
UPDATE "number_series"
   SET "retiredPrefixes" = array_remove("retiredPrefixes", "prefix")
 WHERE "prefix" = ANY("retiredPrefixes");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_series_retired_not_current') THEN
    ALTER TABLE "number_series" ADD CONSTRAINT "number_series_retired_not_current"
      CHECK (NOT ("prefix" = ANY("retiredPrefixes")));
  END IF;
END $$;
