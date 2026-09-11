-- =============================================================================
-- Kartela stok düşümünün TERS YOLU (defter doktrini — tek yönlü defter kapanıyor)
-- =============================================================================
-- `SwatchStockReduction` yalnız düşüm satırı yazıyordu: yanlış düşülen kartela
-- geri gelmiyordu ve hangi kartelaların düşüldüğü yalnız audit yükündeydi (audit
-- 6 ayda arşivlenir). İki ek:
--   ① başlığa ters damga (`reversedAt`/`reversedById`/`reverseReason`) — negatif
--      karşı satır `swatch_stock_reductions_count_pos` CHECK'i yüzünden yazılamaz;
--   ② `swatch_stock_reduction_items` kalem tablosu — geri alma hangi kartelaları
--      stoğa döndüreceğini defterden okur.
--
-- GÜVENLİ: üç NULLABLE kolon + bir YENİ tablo; mevcut satırlara dokunulmaz. Eski
-- düşümlerin kalemi ÜRETİLMEZ (geçmiş uydurulmaz) — kalemsiz düşüm geri alınamaz,
-- servis bunu 409 ile söyler.
-- =============================================================================

ALTER TABLE "swatch_stock_reductions" ADD COLUMN IF NOT EXISTS "reversedAt"    TIMESTAMPTZ;
ALTER TABLE "swatch_stock_reductions" ADD COLUMN IF NOT EXISTS "reversedById"  UUID;
ALTER TABLE "swatch_stock_reductions" ADD COLUMN IF NOT EXISTS "reverseReason" VARCHAR(500);

DO $$ BEGIN
  ALTER TABLE "swatch_stock_reductions" ADD CONSTRAINT "swatch_stock_reductions_reversedById_fkey"
    FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "swatch_stock_reduction_items" (
  "id"          UUID NOT NULL,
  "reductionId" UUID NOT NULL,
  "swatchId"    UUID NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "swatch_stock_reduction_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "swatch_stock_reduction_items_reductionId_swatchId_key"
  ON "swatch_stock_reduction_items" ("reductionId", "swatchId");
CREATE INDEX IF NOT EXISTS "swatch_stock_reduction_items_swatchId_idx"
  ON "swatch_stock_reduction_items" ("swatchId");

DO $$ BEGIN
  ALTER TABLE "swatch_stock_reduction_items" ADD CONSTRAINT "swatch_stock_reduction_items_reductionId_fkey"
    FOREIGN KEY ("reductionId") REFERENCES "swatch_stock_reductions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "swatch_stock_reduction_items" ADD CONSTRAINT "swatch_stock_reduction_items_swatchId_fkey"
    FOREIGN KEY ("swatchId") REFERENCES "swatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
