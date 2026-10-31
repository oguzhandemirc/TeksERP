-- =============================================================================
-- SEYİTOĞLU MİG-1 — DESEN KARTI + VARYANT + ÇİFT ÇÖZGÜ (SY-A1 şema kısmı) — 2026-10-31
-- =============================================================================
-- TAMAMEN EKLEMELİ: üç yeni enum (CREATE TYPE — tip burada DOĞUYOR, ADD VALUE değil),
-- üç yeni tablo (boş), mevcut tablolara yalnız NULLABLE kolon (DEFAULT yok → katalog
-- değişikliği, tablo yeniden yazılmaz). Toplu UPDATE/DELETE YOK; mevcut satırın davranışı değişmez.
--
-- ⚠️ `migrate diff` çıktısındaki iki `DropForeignKey` satırı (rolls/swatches DEFERRABLE
-- composite FK) SİLİNDİ — datamodel'de temsil edilemezler (test_schema_drift).
-- ⚠️ Kısmi unique `product_recipes_item_variant_uq` ŞEMA-DIŞIDIR → envanter `test_db_invariants`.
-- ⚠️ `ItemWarpLayer.beamMode` (2026-10-31 kullanıcı kararı): ek çözgünün sarım biçimi ürün
-- başına seçenek; varsayılan SEPARATE_BEAM = bugünkü ayrı levent davranışı.
-- Tasarım: ~/.tekserp/yeni-dokuma-fabrikasi/TASARIM-2026-10-31.md §2.4, §3.4, §4.4, §16.2.
-- =============================================================================

-- CreateEnum
CREATE TYPE "WeaveDesignKind" AS ENUM ('PLAIN', 'DOBBY', 'JACQUARD', 'LENO');

-- CreateEnum
CREATE TYPE "WarpLayerRole" AS ENUM ('LENO', 'SECONDARY');

-- CreateEnum
CREATE TYPE "WarpBeamMode" AS ENUM ('SEPARATE_BEAM', 'SHARED_BEAM', 'CREEL');

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "weaveDesignId" UUID;

-- AlterTable
ALTER TABLE "product_recipes" ADD COLUMN     "finishingRateCode" VARCHAR(32),
ADD COLUMN     "variantCode" VARCHAR(16);

-- AlterTable
ALTER TABLE "warp_specs" ADD COLUMN     "wastePct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "weaving_orders" ADD COLUMN     "recipeId" UUID,
ADD COLUMN     "weaveDesignId" UUID,
ADD COLUMN     "weftSpecId" UUID;

-- AlterTable
ALTER TABLE "weft_specs" ADD COLUMN     "sequenceCode" VARCHAR(120),
ADD COLUMN     "weftProgramNo" VARCHAR(16);

-- CreateTable
CREATE TABLE "weave_designs" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "WeaveDesignKind" NOT NULL,
    "familyLabel" VARCHAR(40),
    "frameCount" SMALLINT,
    "repeatCm" DECIMAL(8,2),
    "liftPlan" JSONB,
    "loomFileName" VARCHAR(64),
    "lenoSetup" VARCHAR(100),
    "notes" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "weave_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_warp_layers" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warpSpecId" UUID NOT NULL,
    "role" "WarpLayerRole" NOT NULL,
    "beamMode" "WarpBeamMode" NOT NULL DEFAULT 'SEPARATE_BEAM',
    "sortOrder" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "item_warp_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_recipe_weft_yarns" (
    "id" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "weftSortOrder" SMALLINT NOT NULL,
    "yarnItemId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_recipe_weft_yarns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weave_designs_code_key" ON "weave_designs"("code");

-- Katlanmış arama gölgesi — değeri DB üretir (uygulama yazamaz, PG reddeder; WeftSpec emsali).
ALTER TABLE "weave_designs"
  ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;

-- CreateIndex (AD SEDDİ)
CREATE UNIQUE INDEX "weave_designs_nameFold_key" ON "weave_designs"("nameFold");

-- CreateIndex
CREATE INDEX "item_warp_layers_warpSpecId_idx" ON "item_warp_layers"("warpSpecId");

-- CreateIndex
CREATE UNIQUE INDEX "item_warp_layers_itemId_warpSpecId_key" ON "item_warp_layers"("itemId", "warpSpecId");

-- CreateIndex
CREATE UNIQUE INDEX "item_warp_layers_itemId_sortOrder_key" ON "item_warp_layers"("itemId", "sortOrder");

-- CreateIndex
CREATE INDEX "product_recipe_weft_yarns_yarnItemId_idx" ON "product_recipe_weft_yarns"("yarnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipe_weft_yarns_recipeId_weftSortOrder_key" ON "product_recipe_weft_yarns"("recipeId", "weftSortOrder");

-- CreateIndex
CREATE INDEX "items_weaveDesignId_idx" ON "items"("weaveDesignId");

-- CreateIndex
CREATE INDEX "weaving_orders_weftSpecId_idx" ON "weaving_orders"("weftSpecId");

-- CreateIndex
CREATE INDEX "weaving_orders_weaveDesignId_idx" ON "weaving_orders"("weaveDesignId");

-- CreateIndex
CREATE INDEX "weaving_orders_recipeId_idx" ON "weaving_orders"("recipeId");

-- AddForeignKey
ALTER TABLE "weave_designs" ADD CONSTRAINT "weave_designs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weave_designs" ADD CONSTRAINT "weave_designs_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_warp_layers" ADD CONSTRAINT "item_warp_layers_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_warp_layers" ADD CONSTRAINT "item_warp_layers_warpSpecId_fkey" FOREIGN KEY ("warpSpecId") REFERENCES "warp_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_weft_yarns" ADD CONSTRAINT "product_recipe_weft_yarns_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_weft_yarns" ADD CONSTRAINT "product_recipe_weft_yarns_yarnItemId_fkey" FOREIGN KEY ("yarnItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_orders" ADD CONSTRAINT "weaving_orders_weftSpecId_fkey" FOREIGN KEY ("weftSpecId") REFERENCES "weft_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_orders" ADD CONSTRAINT "weaving_orders_weaveDesignId_fkey" FOREIGN KEY ("weaveDesignId") REFERENCES "weave_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weaving_orders" ADD CONSTRAINT "weaving_orders_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_weaveDesignId_fkey" FOREIGN KEY ("weaveDesignId") REFERENCES "weave_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- DB SEDLERİ — CHECK'ler (servis doğrulamasının ikinci hattı)
-- =============================================================================
ALTER TABLE "warp_specs" ADD CONSTRAINT "warp_specs_waste_pct_range"
  CHECK ("wastePct" IS NULL OR ("wastePct" >= 0 AND "wastePct" < 100));
ALTER TABLE "weave_designs" ADD CONSTRAINT "weave_designs_values_ck" CHECK (
  ("frameCount" IS NULL OR ("frameCount" > 0 AND "frameCount" <= 32))
  AND ("repeatCm" IS NULL OR "repeatCm" > 0)
);
ALTER TABLE "item_warp_layers" ADD CONSTRAINT "item_warp_layers_sort_ck" CHECK ("sortOrder" >= 0);
ALTER TABLE "product_recipe_weft_yarns" ADD CONSTRAINT "product_recipe_weft_yarns_sort_ck" CHECK ("weftSortOrder" >= 0);

-- =============================================================================
-- ŞEMA-DIŞI PARTIAL UNIQUE — ürün başına varyant kodu tekil (kodsuz reçeteler serbest)
-- =============================================================================
CREATE UNIQUE INDEX "product_recipes_item_variant_uq" ON "product_recipes"("itemId", "variantCode")
  WHERE "variantCode" IS NOT NULL;
