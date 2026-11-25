-- D4b (Seyitoğlu ürün kartı denetimi, 2026-11-25): kumaş ticari alanları + iplik teknik alanları + asgari stok.
-- ADDITIVE / EXPAND: iki yeni tip, items'a dokuz boş bırakılabilir kolon, üç CHECK. Veri dönüştürme YOK;
-- mevcut satırların hepsi NULL kalır → CHECK'ler eski veride geçerlidir. Tipler bu dosyada DOĞUYOR (ADD VALUE değil).

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "YarnTwistDirection" AS ENUM ('S', 'Z');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
DO $t$ BEGIN CREATE TYPE "YarnLuster" AS ENUM ('BRIGHT', 'SEMI_DULL', 'FULL_DULL');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AlterTable
ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "yarnFilamentCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "yarnPly" INTEGER,
  ADD COLUMN IF NOT EXISTS "yarnTwistTpm" INTEGER,
  ADD COLUMN IF NOT EXISTS "yarnTwistDirection" "YarnTwistDirection",
  ADD COLUMN IF NOT EXISTS "yarnLuster" "YarnLuster",
  ADD COLUMN IF NOT EXISTS "minStockQty" DECIMAL(14,3),
  ADD COLUMN IF NOT EXISTS "standardRollLengthM" DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS "minOrderQty" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "careInstructions" VARCHAR(500);

-- İplik teknik alanları yalnız YARN; filament ve kat > 0, büküm ≥ 0 (0 = bükümsüz). Servis 400 ilk hat, bu son hat.
DO $t$ BEGIN ALTER TABLE "items" ADD CONSTRAINT "items_yarn_spec_ck" CHECK (
  ("yarnFilamentCount" IS NULL AND "yarnPly" IS NULL AND "yarnTwistTpm" IS NULL AND "yarnTwistDirection" IS NULL AND "yarnLuster" IS NULL)
  OR ("itemType" = 'YARN'
      AND ("yarnFilamentCount" IS NULL OR "yarnFilamentCount" > 0)
      AND ("yarnPly" IS NULL OR "yarnPly" > 0)
      AND ("yarnTwistTpm" IS NULL OR "yarnTwistTpm" >= 0))
); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- Asgari stok yalnız İPLİK / SARF ve > 0.
DO $t$ BEGIN ALTER TABLE "items" ADD CONSTRAINT "items_min_stock_qty_ck" CHECK (
  "minStockQty" IS NULL OR ("itemType" IN ('YARN', 'CONSUMABLE') AND "minStockQty" > 0)
); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- Kumaş ticari alanları yalnız FABRIC; top boyu ve asgari sipariş > 0.
DO $t$ BEGIN ALTER TABLE "items" ADD CONSTRAINT "items_fabric_trade_ck" CHECK (
  ("standardRollLengthM" IS NULL AND "minOrderQty" IS NULL AND "careInstructions" IS NULL)
  OR ("itemType" = 'FABRIC'
      AND ("standardRollLengthM" IS NULL OR "standardRollLengthM" > 0)
      AND ("minOrderQty" IS NULL OR "minOrderQty" > 0))
); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
