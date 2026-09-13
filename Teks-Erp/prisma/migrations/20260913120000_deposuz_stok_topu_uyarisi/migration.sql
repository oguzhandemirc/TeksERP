-- =============================================================================
-- DEPOSUZ STOK TOPU — deploy anında ÖLÇ ve UYAR (veri YAZMAZ)
-- =============================================================================
-- 2026-09-13'te defter kapısı sertleşti: stok kümesinden çıkan bir topun deposu
-- yoksa yol 409 verir (`assertRollsHaveWarehouse`). Kapının dayandığı varsayım
-- "deposuz top yok"tu ve o varsayım ÖLÇÜLDÜĞÜNDE bir KOD ÖZELLİĞİ değil bir OLAY
-- çıktı: `scripts/backfill_roll_warehouse.ts` hiçbir migration, deploy script'i
-- ya da boot job'undan çağrılmıyor — birinin bir kez elle koşturmasıyla 0'a indi.
--
-- ⇒ Yalnız `migrate deploy` koşan ya da eski bir yedekten dönen bir kurulumda
--   2026-08-13 öncesi toplar HÂLÂ deposuz olabilir ve ilk sevk denemesi 409 yer.
--   Bu migration o kurulumu deploy GÜNLÜĞÜNDE uyarır.
--
-- ⚠️ NEDEN VERİ YAZMIYOR: toplu düzeltme dry-run varsayılandır ve `--apply`
--    KULLANICININ kararıdır (kök kural). Backfill'i deploy'a otomatik koşturmak
--    o kararı elinden alır. Migration yalnız ÖLÇER ve betiği ADIYLA söyler.
--
-- ⚠️ SINIRI YAZILI: migration BİR KEZ koşar. Bugün temiz olup yarın kirlenen bir
--    kurulumu bu yakalamaz — tekrarlanabilir ölçüm `scripts/consistency-check.sql`
--    §12'de, her `npm test` koşumunda. İkisi aynı soruyu iki kadansta sorar.
-- =============================================================================
DO $$
DECLARE deposuz bigint;
BEGIN
  SELECT count(*) INTO deposuz
    FROM rolls
   WHERE "warehouseId" IS NULL
     AND status IN ('STOCK', 'WAREHOUSE', 'A1_STOCK', 'RETURNED_FROM_SUBCONTRACTOR');
  IF deposuz = 0 THEN
    RAISE NOTICE 'deposuz stok topu: 0 — sevk/iade kapisi bu kurulumda guvenli.';
  ELSE
    -- WARNING, NOTICE DEĞİL: notice deploy günlüklerinde kaybolur.
    RAISE WARNING
      'DEPOSUZ STOK TOPU: % adet — bu toplarin sevki/iadesi 409 ile durur. Once: npx tsx scripts/backfill_roll_warehouse.ts (dry-run varsayilan, --apply kullanici karari)',
      deposuz;
  END IF;
END $$;
