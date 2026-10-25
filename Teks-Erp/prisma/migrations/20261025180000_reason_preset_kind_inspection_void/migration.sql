-- =============================================================================
-- `ReasonPresetKind` + INSPECTION_VOID (K4P muayene iptali sebep kataloğu)
-- =============================================================================
-- ⚠️ YALNIZ ADD VALUE (55P04 kuralı); katalog satırları uygulama boot uzlaştırmasıyla doğar
--   (`reason-preset-catalog.job`), migration veri yazmaz. İdempotent.
ALTER TYPE "ReasonPresetKind" ADD VALUE IF NOT EXISTS 'INSPECTION_VOID';
