-- =============================================================================
-- `ReasonPresetKind` + WORK_ORDER_PLAN_CHANGE (iş emri hareket defteri D5)
-- =============================================================================
-- ⚠️ YALNIZ ADD VALUE (55P04 kuralı); katalog satırları uygulama boot uzlaştırmasıyla doğar
--   (`reason-preset-catalog.job`), migration veri yazmaz. İdempotent.
ALTER TYPE "ReasonPresetKind" ADD VALUE IF NOT EXISTS 'WORK_ORDER_PLAN_CHANGE';
