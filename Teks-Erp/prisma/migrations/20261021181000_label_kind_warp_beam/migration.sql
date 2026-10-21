-- =============================================================================
-- `LabelKind` + WARP_BEAM (levent etiketi — dokuma manuel veri S1b, D12)
-- =============================================================================
-- ADDITIVE. ⚠️ YALNIZ ADD VALUE (PG 55P04); MACHINE değerinden AYRI dosya (tek ifade
--   kuralı). Migration veri yazmaz. İdempotent (`IF NOT EXISTS`). Geri alınamaz.
ALTER TYPE "LabelKind" ADD VALUE IF NOT EXISTS 'WARP_BEAM';
