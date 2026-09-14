-- =============================================================================
-- `ReasonPresetKind` + YARN_SUBCONTRACT_RETURN (fason G1, 3/4)
-- =============================================================================
-- ⚠️ YALNIZ ADD VALUE (55P04 kuralı); katalog satırları uygulama boot uzlaştırmasıyla doğar
--   (`reason-preset-catalog.job`: KALAN_IPLIK · KALITE · IPTAL), migration veri yazmaz. İdempotent.
ALTER TYPE "ReasonPresetKind" ADD VALUE IF NOT EXISTS 'YARN_SUBCONTRACT_RETURN';
