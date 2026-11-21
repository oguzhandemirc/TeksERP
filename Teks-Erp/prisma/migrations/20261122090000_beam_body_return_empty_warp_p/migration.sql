-- =============================================================================
-- DEVERE EK P — FULL_OUT gövdenin BOŞ DÖNÜŞÜ sarımı taşıyabilir (2026-11-22)
-- =============================================================================
-- Yalnız GEVŞETME: `beam_body_events_warp_ck` (sarım ⇔ sarım türü, eşitlik) iki tek yönlü CHECK'e bölünür:
--   ① sarım türü ⇒ sarım dolu (eskisiyle aynı)  ② sarım dolu ⇒ sarım türü YA DA RETURN_EMPTY(_CANCEL).
-- Eski kısıtı sağlayan her satır ikisini de sağlar (RETURN_EMPTY satırları bugün hep sarımsız).
-- =============================================================================

ALTER TABLE "beam_body_events" DROP CONSTRAINT IF EXISTS "beam_body_events_warp_ck";

ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_warp_ck"
  CHECK ("warpBeamId" IS NOT NULL OR "kind" NOT IN (
    'FILLED', 'FILLED_CANCEL', 'MOUNTED', 'MOUNTED_CANCEL', 'DISMOUNTED', 'DISMOUNTED_CANCEL',
    'EMPTIED', 'EMPTIED_CANCEL', 'SHIPPED_FULL', 'SHIPPED_FULL_CANCEL', 'RETURNED_FULL', 'RETURNED_FULL_CANCEL'
  ));

ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_warp_allowed_ck"
  CHECK ("warpBeamId" IS NULL OR "kind" IN (
    'FILLED', 'FILLED_CANCEL', 'MOUNTED', 'MOUNTED_CANCEL', 'DISMOUNTED', 'DISMOUNTED_CANCEL',
    'EMPTIED', 'EMPTIED_CANCEL', 'SHIPPED_FULL', 'SHIPPED_FULL_CANCEL', 'RETURNED_FULL', 'RETURNED_FULL_CANCEL',
    'RETURN_EMPTY', 'RETURN_EMPTY_CANCEL'
  ));
