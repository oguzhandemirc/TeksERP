-- =============================================================================
-- `ReasonPresetKind` + WARP_BEAM_ADJUST · WARP_BEAM_SCRAP (devere Faz 3, 2/3)
-- =============================================================================
-- ⚠️ YALNIZ ADD VALUE (55P04 kuralı); katalog satırları uygulama boot uzlaştırmasıyla doğar
--   (`reason-preset-catalog.job`), migration veri yazmaz. Sona, idempotent.
ALTER TYPE "ReasonPresetKind" ADD VALUE IF NOT EXISTS 'WARP_BEAM_ADJUST';
ALTER TYPE "ReasonPresetKind" ADD VALUE IF NOT EXISTS 'WARP_BEAM_SCRAP';
