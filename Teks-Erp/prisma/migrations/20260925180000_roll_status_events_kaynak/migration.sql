-- =============================================================================
-- TOP DURUM DEFTERİ — göç satırının KAYNAĞI (K-A3b, 2026-09-25)
-- =============================================================================
-- `scripts/backfill_roll_status_events.ts` iki geçişlidir: ① topun iptal
-- kolonlarından · ② kolonda aktör yokken audit'in son CANCELLED satırından
-- (kuralın beyanlı "bir kez aktaran göç" istisnası). İki kaynak ayrışabilsin diye
-- göç satırı kaynağını taşır.
--
-- ADDITIVE: nullable kolon + CHECK; mevcut satırlar (hepsi NULL) geçerli kalır.
-- Geriye doldurma YOK — defter mühürlüdür (UPDATE red) ve sahada göç henüz koşmadı.
-- İDEMPOTENT: ADD COLUMN IF NOT EXISTS · CHECK duplicate_object yutulur.
-- =============================================================================

ALTER TABLE "roll_status_events" ADD COLUMN IF NOT EXISTS "preEpochSource" VARCHAR(16);

DO $$ BEGIN
  ALTER TABLE "roll_status_events" ADD CONSTRAINT "roll_status_events_pre_epoch_source_check"
    CHECK ("preEpochSource" IS NULL OR ("preEpoch" AND "preEpochSource" IN ('ROLL_COLUMNS', 'AUDIT')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
