-- =============================================================================
-- Önceki migration'daki iki CHECK'i DOĞRULA (ayrı dosya — DB kuralı 14)
-- =============================================================================
-- `VALIDATE CONSTRAINT` mevcut satırları tarar ama ACCESS EXCLUSIVE kilidi TUTMAZ
-- (yalnız SHARE UPDATE EXCLUSIVE); ekleme ile doğrulamayı ayırmanın sebebi budur.
-- =============================================================================

ALTER TABLE "warehouse_movements" VALIDATE CONSTRAINT "warehouse_movements_qty_positive";
ALTER TABLE "warehouse_movements" VALIDATE CONSTRAINT "warehouse_movements_direction_present";
