-- =============================================================================
-- CustomerBranch.defaultDestination — şubenin sevk yönü (DOMESTIC|EXPORT), NULL serbest.
-- ADDITIVE, backfill YOK: NULL = şube kendi yönünü taşımaz, sevk yönü cariden çözülür
-- (bugünkü davranış). Eski sevkiyatlar kendi yönünü donmuş taşır, dokunulmaz.
-- İdempotent.
-- =============================================================================
ALTER TABLE "customer_branches" ADD COLUMN IF NOT EXISTS "defaultDestination" "ShipmentDestination";
