-- =============================================================================
-- SEYİTOĞLU MİG-3 — SİPARİŞ/TEKLİF/FİYAT LİSTESİ VARYANTI + SATIR HEDEF DEĞERİ (SY-K1) — 2026-10-31
-- =============================================================================
-- EKLEMELİ: üç tabloya NULLABLE `recipeId` (NULL = desen geneli, bugünkü), bir yeni boş tablo.
-- `price_list_lines_item_color_uq` yeniden kurulur: (priceListId, itemId, COALESCE(colorId))
-- → + COALESCE(recipeId, sıfır-UUID). Bugünkü satırlarda recipeId NULL → ESKİ tekillik aynen.
-- Drop + create AYNI dosyada (tek tx). Toplu UPDATE/DELETE YOK. Tasarım §7.4, §12.4, §16.2 madde 4.
-- =============================================================================

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "recipeId" UUID;

-- AlterTable
ALTER TABLE "price_list_lines" ADD COLUMN     "recipeId" UUID;

-- AlterTable
ALTER TABLE "sales_quote_lines" ADD COLUMN     "recipeId" UUID;

-- CreateTable
CREATE TABLE "order_line_target_values" (
    "id" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "valueId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_line_target_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_line_target_values_propertyId_idx" ON "order_line_target_values"("propertyId");

-- CreateIndex
CREATE INDEX "order_line_target_values_valueId_idx" ON "order_line_target_values"("valueId");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_target_values_orderLineId_propertyId_key" ON "order_line_target_values"("orderLineId", "propertyId");

-- CreateIndex
CREATE INDEX "order_lines_recipeId_idx" ON "order_lines"("recipeId");

-- CreateIndex
CREATE INDEX "price_list_lines_recipeId_idx" ON "price_list_lines"("recipeId");

-- CreateIndex
CREATE INDEX "sales_quote_lines_recipeId_idx" ON "sales_quote_lines"("recipeId");

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_target_values" ADD CONSTRAINT "order_line_target_values_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_target_values" ADD CONSTRAINT "order_line_target_values_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_target_values" ADD CONSTRAINT "order_line_target_values_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- ŞEMA-DIŞI EXPRESSION UNIQUE — liste içinde ürün + renk + varyant başına tek satır
-- =============================================================================
DROP INDEX IF EXISTS "price_list_lines_item_color_uq";
CREATE UNIQUE INDEX "price_list_lines_item_color_uq" ON "price_list_lines"(
  "priceListId",
  "itemId",
  COALESCE("colorId", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("recipeId", '00000000-0000-0000-0000-000000000000'::uuid)
);
