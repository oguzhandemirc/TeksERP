-- =============================================================================
-- Customer.defaultDestination — sevk hedefi VARSAYILANI (DOMESTIC|EXPORT), NULL serbest.
-- ADDITIVE, backfill YOK: eski sevkiyatlara ve carilere dokunulmaz; alan yeni
-- kayıtlarda kullanıcı doldurdukça dolar. Varsayılan = bugünkü davranış (NULL).
-- İdempotent.
-- =============================================================================
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "defaultDestination" "ShipmentDestination";
