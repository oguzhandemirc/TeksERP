-- =============================================================================
-- `rolls_qty_le_initial` — KOŞULLU doğrulama
-- =============================================================================
-- 20260829140000 kısıtı bilerek `NOT VALID` ekledi ("yumuşak kapı"): fabrikadaki
-- eski ihlal satırları deploy'u düşürmesin. Doğrulamanın ELLE koşulacağı aynı
-- dosyaya yazıldı ama koşulmadı — yani TAZE kurulumda kısıt `NOT VALID` doğuyor
-- ve `scripts/test_db_invariants.ts` orada kırmızı veriyor (ölçüldü 2026-09-12,
-- CI biçimli taze `teks_ci` koşumu).
--
-- ⚠️ KOŞULSUZ `VALIDATE` YAZILAMAZ: ihlal satırı olan bir kurulumda `migrate
--    deploy` DÜŞER ve sürüm sahaya inemez. Canlıda eski satırlar durabilir
--    (onarım fabrikanın YEDEĞİNİN kopyasında koştu) ve canlıdaki onarım
--    KULLANICININ kararıdır — bir migration'ın ön koşuluna çevrilemez.
--
-- Üç kurulum sınıfı, üç ayrı kapatıcı:
--   taze / CI    → bu migration (0 ihlal → VALIDATE)
--   temizlenmiş  → zaten VALID, `VALIDATE` no-op
--   kirli canlı  → `scripts/fix_tambur_undo_full_asim.ts`: onarımı bitiren kapıyı
--                  da kapatır. Migration BİR KEZ koşar; sonradan temizlenen
--                  kurulumu o yakalayamaz, yakalarsa kısıt sonsuza dek NOT VALID
--                  kalır ve bekçi orada kalıcı kırmızı verirdi.
-- =============================================================================
DO $$
DECLARE ihlal bigint;
BEGIN
  SELECT count(*) INTO ihlal FROM rolls WHERE "currentQty" > "initialQty";
  IF ihlal = 0 THEN
    ALTER TABLE rolls VALIDATE CONSTRAINT rolls_qty_le_initial;
  ELSE
    -- WARNING, NOTICE DEĞİL: notice deploy günlüklerinde kaybolur.
    RAISE WARNING
      'rolls_qty_le_initial NOT VALID birakildi — % ihlal satiri var. Once: npx tsx scripts/fix_tambur_undo_full_asim.ts',
      ihlal;
  END IF;
END $$;
