-- =============================================================================
-- TEZGÂH PLANLAMA ALANLARI — `machines.planRpm` · `planEfficiencyPct` · `maxWorkingWidthCm`
-- (Seyitoğlu temel, 2026-11-11) — ADDITIVE: üç NULLABLE kolon + üç CHECK; veri yazmaz.
-- =============================================================================
-- Plan devri/randımanı/azami çalışma eni yalnız öneri girdisidir. `MachineSpec` satırı
-- "izleniyor" demek olduğu için (dokuma.md) plan hızı oraya yazılmaz. NULL = bilinmiyor.
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.

ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "planRpm" INTEGER;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "planEfficiencyPct" DECIMAL(5,2);
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "maxWorkingWidthCm" DECIMAL(6,2);

ALTER TABLE "machines" DROP CONSTRAINT IF EXISTS "machines_plan_rpm_pos";
ALTER TABLE "machines" ADD CONSTRAINT "machines_plan_rpm_pos" CHECK ("planRpm" IS NULL OR "planRpm" > 0);

ALTER TABLE "machines" DROP CONSTRAINT IF EXISTS "machines_plan_efficiency_range";
ALTER TABLE "machines" ADD CONSTRAINT "machines_plan_efficiency_range"
  CHECK ("planEfficiencyPct" IS NULL OR ("planEfficiencyPct" > 0 AND "planEfficiencyPct" <= 100));

ALTER TABLE "machines" DROP CONSTRAINT IF EXISTS "machines_max_working_width_pos";
ALTER TABLE "machines" ADD CONSTRAINT "machines_max_working_width_pos" CHECK ("maxWorkingWidthCm" IS NULL OR "maxWorkingWidthCm" > 0);
