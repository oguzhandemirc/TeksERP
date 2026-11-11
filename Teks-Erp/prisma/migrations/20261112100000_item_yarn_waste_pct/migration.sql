-- =============================================================================
-- İPLİK BAŞINA FİRE — `items.yarnWastePct` (Seyitoğlu 3. bölüm I2, 2026-11-12)
-- ADDITIVE: tek NULLABLE kolon + CHECK; veri yazmaz. NULL = bugünkü davranış (yapı/kart/parametre firesi).
-- =============================================================================
-- Doluysa iplik kg/m'si bu yüzdeyle hesaplanır (tek çözücü `helpers/yarn-waste.helper.ts`).
-- CHECK: 0..50 ve yalnız YARN kartında (itemType güncellenemez — servis FORBIDDEN listesi).
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "yarnWastePct" DECIMAL(5,2);

ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_yarn_waste_pct_ck";
ALTER TABLE "items" ADD CONSTRAINT "items_yarn_waste_pct_ck"
  CHECK ("yarnWastePct" IS NULL OR ("itemType" = 'YARN' AND "yarnWastePct" >= 0 AND "yarnWastePct" <= 50));
