-- =============================================================================
-- Add item_variants table + variantId columns on rolls / order_lines
-- =============================================================================
-- Bu migration eskiden manuel olarak DB'ye yamanmıştı; clean reset için
-- gerekli yapıyı kalıcı olarak kayıt altına alıyor. 20260418 swatch migration'ı
-- ve 20260424 customer_variant_alias migration'ı bu tabloya FK koyuyor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "item_variants" (
    "id"        TEXT NOT NULL,
    "itemId"    TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "item_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "item_variants_itemId_code_key"
    ON "item_variants"("itemId", "code");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_variants_itemId_fkey') THEN
    ALTER TABLE "item_variants"
      ADD CONSTRAINT "item_variants_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "items"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- rolls.variantId
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
CREATE INDEX IF NOT EXISTS "rolls_variantId_idx" ON "rolls"("variantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rolls_variantId_fkey') THEN
    ALTER TABLE "rolls"
      ADD CONSTRAINT "rolls_variantId_fkey"
      FOREIGN KEY ("variantId") REFERENCES "item_variants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- order_lines.variantId
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "variantId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_lines_variantId_fkey') THEN
    ALTER TABLE "order_lines"
      ADD CONSTRAINT "order_lines_variantId_fkey"
      FOREIGN KEY ("variantId") REFERENCES "item_variants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
