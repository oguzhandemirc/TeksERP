-- Kumaş sınıflandırması üç eksen (2026-11-25, kullanıcı kararı): WeaveDesign.kind iki ekseni karıştırıyordu
-- (PLAIN/LENO örgü, DOBBY/JACQUARD ağızlık mekanizması). EXPAND: yeni tipler + nullable kolonlar + backfill.
-- `kind` KALIR (eski istemci okur; servis çift yazar); NOT NULL + `kind` düşürme = contract, ayrı sürüm.
-- Tipler bu dosyada DOĞUYOR (CREATE TYPE) → ADD VALUE kısıtı (55P04) yok; aynı dosyada kullanılabilir.

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "WeaveShedMechanism" AS ENUM ('CAM', 'DOBBY', 'JACQUARD');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
DO $t$ BEGIN CREATE TYPE "WeaveStructure" AS ENUM ('PLAIN', 'TWILL', 'SATIN', 'LENO', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
DO $t$ BEGIN CREATE TYPE "FabricTechnique" AS ENUM ('WOVEN', 'KNITTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AlterTable
ALTER TABLE "weave_designs"
  ADD COLUMN IF NOT EXISTS "shedMechanism" "WeaveShedMechanism",
  ADD COLUMN IF NOT EXISTS "weaveStructure" "WeaveStructure",
  ADD COLUMN IF NOT EXISTS "hookCount" SMALLINT,
  ADD COLUMN IF NOT EXISTS "repeatWidthCm" DECIMAL(8,2);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "fabricTechnique" "FabricTechnique";

-- CreateTable — desen görseli (kart başına tek; certificate_files emsali)
CREATE TABLE IF NOT EXISTS "weave_design_images" (
    "id" UUID NOT NULL,
    "weaveDesignId" UUID NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "weave_design_images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "weave_design_images_weaveDesignId_key" ON "weave_design_images"("weaveDesignId");
CREATE INDEX IF NOT EXISTS "weave_design_images_uploadedById_idx" ON "weave_design_images"("uploadedById");
DO $t$ BEGIN ALTER TABLE "weave_design_images" ADD CONSTRAINT "weave_design_images_weaveDesignId_fkey" FOREIGN KEY ("weaveDesignId") REFERENCES "weave_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
DO $t$ BEGIN ALTER TABLE "weave_design_images" ADD CONSTRAINT "weave_design_images_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- BACKFILL — eşleme tek kaynağın (`src/constants/weave-classification.ts` KIND_TO_CLASS) SQL ikizi;
-- `test_desen_siniflama` ikisini karşılaştırır. Yalnız boş satırlar (yeniden koşum idempotent).
UPDATE "weave_designs" SET
  "shedMechanism" = CASE "kind"
    WHEN 'PLAIN' THEN 'CAM'::"WeaveShedMechanism"
    WHEN 'DOBBY' THEN 'DOBBY'::"WeaveShedMechanism"
    WHEN 'JACQUARD' THEN 'JACQUARD'::"WeaveShedMechanism"
    WHEN 'LENO' THEN 'DOBBY'::"WeaveShedMechanism"
  END,
  "weaveStructure" = CASE "kind"
    WHEN 'PLAIN' THEN 'PLAIN'::"WeaveStructure"
    WHEN 'LENO' THEN 'LENO'::"WeaveStructure"
    ELSE NULL
  END
WHERE "shedMechanism" IS NULL;

UPDATE "items" SET "fabricTechnique" = 'WOVEN' WHERE "itemType" = 'FABRIC' AND "fabricTechnique" IS NULL;

-- CHECK (servis doğrulamasının ikinci hattı)
DO $t$ BEGIN ALTER TABLE "weave_designs" ADD CONSTRAINT "weave_designs_class_values_ck" CHECK (
  ("hookCount" IS NULL OR ("hookCount" BETWEEN 1 AND 30000))
  AND ("repeatWidthCm" IS NULL OR "repeatWidthCm" > 0)
); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
DO $t$ BEGIN ALTER TABLE "weave_design_images" ADD CONSTRAINT "weave_design_images_size_ck"
  CHECK ("sizeBytes" BETWEEN 1 AND 5242880 AND octet_length("content") = "sizeBytes");
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
DO $t$ BEGIN ALTER TABLE "weave_design_images" ADD CONSTRAINT "weave_design_images_mime_ck"
  CHECK ("mimeType" IN ('image/jpeg', 'image/png') AND char_length("sha256") = 64);
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
