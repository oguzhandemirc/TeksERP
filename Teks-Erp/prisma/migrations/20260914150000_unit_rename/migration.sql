-- =============================================================================
-- AD TURU `pick*` → `unit*` (DOKUMA-TEZGAH-IZLEME-TASARIMI #24 borcu; 2026-09-14, 01)
-- =============================================================================
-- NE YAPIYOR: dokuz kolonu YENİDEN ADLANDIRIR (veri/tip/CHECK/index DEĞİŞMEZ — RENAME
--   COLUMN meta-veri işlemidir, tablo yeniden yazılmaz, canlıda anlık). Hız/kapasite
--   terimleri atkıya (pick) değil ÜRETİM BİRİMİNE (unit: atkı · sıra · rack) aittir;
--   `unitsPerCm` zaten öyleydi, kalanlar bugün hizalandı. Sayaç OKUMALARI bu turun
--   dışında (`picksAtClose` · `pickCounter` · `PICK_COUNTER`): onlar cihazın gerçek
--   atkı sayacıdır, soyutlama değil.
-- ⚠️ İDEMPOTENT: her RENAME yalnız eski ad varsa koşar (ikinci koşum sessiz).
-- ⚠️ `machine_shift_stats_terms_nonneg` CHECK'i kolon adına bağlıdır; RENAME COLUMN PG'de
--   CHECK ifadesini de günceller (pg_get_constraintdef yeni adı basar) — `test_db_invariants`
--   §2 ad üstünden ölçtüğü için değişmez.
-- =============================================================================

CREATE OR REPLACE FUNCTION pg_temp.tekserp_rename_col(t text, eski text, yeni text) RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = eski)
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = yeni) THEN
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', t, eski, yeni);
  END IF;
END $$ LANGUAGE plpgsql;

SELECT pg_temp.tekserp_rename_col('machine_runs',             'targetPicksPerMin',     'targetUnitsPerMin');
SELECT pg_temp.tekserp_rename_col('machine_specs',            'nominalPicksPerMin',    'nominalUnitsPerMin');
SELECT pg_temp.tekserp_rename_col('machine_shift_stats',      'picksActual',           'unitsActual');
SELECT pg_temp.tekserp_rename_col('machine_shift_stats',      'gapPicks',              'gapUnits');
SELECT pg_temp.tekserp_rename_col('machine_shift_stats',      'targetPickCapacityApt', 'targetUnitCapacityApt');
SELECT pg_temp.tekserp_rename_col('machine_shift_stats',      'targetPickCapacityPot', 'targetUnitCapacityPot');
SELECT pg_temp.tekserp_rename_col('machine_shift_stats',      'targetPicksPerMin',     'targetUnitsPerMin');
SELECT pg_temp.tekserp_rename_col('machine_shift_stat_seals', 'picksActual',           'unitsActual');
SELECT pg_temp.tekserp_rename_col('machine_shift_stat_seals', 'targetPickCapacityPot', 'targetUnitCapacityPot');
