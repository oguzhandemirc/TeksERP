-- Hazır sebep katalogları (fire · kayıt düzeltmesi · elle top ekleme · top iptali)
-- tek tabloda. Satırların kendisi boot uzlaştırmasıyla gelir
-- (`jobs/reason-preset-catalog.job.ts`) — bu migration YALNIZ yapıyı kurar.
--
-- ⚠️ `migrate diff` çıktısındaki iki `DropForeignKey` satırı BİLEREK SİLİNDİ:
-- `rolls_sackId_shipmentId_consistency_fkey` ve `swatches_...` DEFERRABLE
-- composite FK'lardır, Prisma datamodel'inde temsil edilemezler ve her diff'te
-- düşürülmek istenir (bkz. schema.prisma:2557-2558 + perf kuralı 4).

-- CreateEnum
CREATE TYPE "ReasonPresetKind" AS ENUM ('ROLL_SCRAP', 'ROLL_RECORD_CORRECTION', 'ROLL_MANUAL_ENTRY', 'ROLL_CANCEL');

-- CreateTable
CREATE TABLE "reason_presets" (
    "id" UUID NOT NULL,
    "kind" "ReasonPresetKind" NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "fullText" VARCHAR(500),
    "requiresText" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reason_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reason_presets_kind_isActive_sortOrder_idx" ON "reason_presets"("kind", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "reason_presets_kind_code_key" ON "reason_presets"("kind", "code");
