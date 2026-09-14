-- =============================================================================
-- `WarpBeamStatus` + MOUNTED · EXHAUSTED · SCRAPPED (devere Faz 3, 1/3)
-- =============================================================================
-- ⚠️ YALNIZ ADD VALUE — yeni enum değeri onu yaratan tx'te KULLANILAMAZ (55P04);
--   değeri kullanan ifadeler (partial index yüklemi · CHECK) 180200'de. Sona, idempotent.
-- ⛔ GERİ ALINAMAZ: PostgreSQL enum değeri düşürmeyi desteklemez.
ALTER TYPE "WarpBeamStatus" ADD VALUE IF NOT EXISTS 'MOUNTED';
ALTER TYPE "WarpBeamStatus" ADD VALUE IF NOT EXISTS 'EXHAUSTED';
ALTER TYPE "WarpBeamStatus" ADD VALUE IF NOT EXISTS 'SCRAPPED';
