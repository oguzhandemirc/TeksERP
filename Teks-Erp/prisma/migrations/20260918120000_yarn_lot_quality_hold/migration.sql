-- İPLİK LOTU KALİTE BEKLETME (2026-09-18) — şema YALNIZ EKLER: `YarnLotQualityStatus` enum + `yarn_lots` üç kolon.
-- Varsayılan RELEASED = bugünkü davranış (mevcut lotlar serbest doğar; kapı yalnız bayrak açıkken koşar).
-- İDEMPOTENT (deploy-kurulum.md): enum duplicate_object yutulur, kolon/indeks IF NOT EXISTS.
-- ⚠️ `migrate diff` çıktısındaki DropForeignKey satırları (rolls/swatches DEFERRABLE FK) BİLEREK atıldı.

-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "YarnLotQualityStatus" AS ENUM ('RELEASED', 'ON_HOLD', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "yarn_lots" ADD COLUMN IF NOT EXISTS "qualityStatus" "YarnLotQualityStatus" NOT NULL DEFAULT 'RELEASED';
ALTER TABLE "yarn_lots" ADD COLUMN IF NOT EXISTS "qualityDecidedAt" TIMESTAMPTZ;
ALTER TABLE "yarn_lots" ADD COLUMN IF NOT EXISTS "qualityDecidedById" UUID;
ALTER TABLE "yarn_lots" ADD COLUMN IF NOT EXISTS "qualityNote" VARCHAR(300);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "yarn_lots_qualityStatus_idx" ON "yarn_lots"("qualityStatus");
