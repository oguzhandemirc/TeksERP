-- =============================================================================
-- İPLİK SATIN ALMA BİRİMİ — Seyitoğlu SY-a (2026-11-21)
-- ADDITIVE: yeni enum + iki NULLABLE kolon (items) + varsayılanlı kolon (yarn_cost_prices); veri yazmaz.
-- NULL birim = KG (bugünkü davranış). Fiyat satırı birimi yazım anında donar; eski satırlar KG.
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "YarnPurchaseUnit" AS ENUM ('KG', 'ADET', 'METRE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "yarnPurchaseUnit" "YarnPurchaseUnit";
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "yarnPiecesPerM" DECIMAL(10,3);

ALTER TABLE "yarn_cost_prices" ADD COLUMN IF NOT EXISTS "unit" "YarnPurchaseUnit" NOT NULL DEFAULT 'KG';

-- Birim yalnız İPLİK kartında (itemType güncellenemez — servis FORBIDDEN listesi).
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_yarn_purchase_unit_ck";
ALTER TABLE "items" ADD CONSTRAINT "items_yarn_purchase_unit_ck"
  CHECK ("yarnPurchaseUnit" IS NULL OR "itemType" = 'YARN');

-- Metredeki adet yalnız ADET birimde ve > 0. NULL birim (= KG) için `= 'ADET'` NULL döner ve CHECK'i
-- geçirirdi; bu yüzden IS NOT DISTINCT FROM.
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_yarn_pieces_per_m_ck";
ALTER TABLE "items" ADD CONSTRAINT "items_yarn_pieces_per_m_ck"
  CHECK ("yarnPiecesPerM" IS NULL OR ("yarnPurchaseUnit" IS NOT DISTINCT FROM 'ADET' AND "yarnPiecesPerM" > 0));
