-- =============================================================================
-- `SubcontractorDispatchItemKind` + YARN (fason G1, 1/4 — 2026-09-15, 01)
-- =============================================================================
-- ⚠️ YALNIZ ADD VALUE (PG 55P04: yeni enum değeri onu yaratan tx'te kullanılamaz;
--   RECETELER § enum 2. adım). Kolon/CHECK 20260915023000'de. İdempotent. GERİ ALINAMAZ.
ALTER TYPE "SubcontractorDispatchItemKind" ADD VALUE IF NOT EXISTS 'YARN';
