-- Refakat kartı şablonu (üç kademeli kişiselleştirme: BUILTIN / SECTIONS / RAW_HTML).
--
-- ⚠️ Prisma'nın ürettiği iki `DropForeignKey` satırı SİLİNDİ (sacks composite FK
--    drift'i — datamodel'de temsil edilemeyen `rolls_sackId_shipmentId_consistency_fkey`
--    ve `swatches_...` her diff'te düşürülmek istenir; bkz. schema.prisma notu).
--
-- ⚠️ `isDefault` unique'i PARTIAL'a çevrildi. Prisma'nın ürettiği düz UNIQUE
--    felaket olurdu: `isDefault=false` değeri de benzersiz sayılır → sistemde
--    toplam İKİ şablon (biri default, biri değil) tutulabilirdi. İstenen garanti
--    "en fazla BİR default" olduğu için index yalnız true satırlarını kapsar
--    (emsal: label_templates_one_default_per_kind, roll_movements_one_open).
--    Şemada @@unique olarak bırakıldı çünkü Prisma 7 predicate farkını drift
--    saymaz ama index↔unique farkını SAYAR (perf kuralı 4).

-- CreateEnum
CREATE TYPE "TravelerTemplateMode" AS ENUM ('BUILTIN', 'SECTIONS', 'RAW_HTML');

-- CreateTable
CREATE TABLE "traveler_card_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "mode" "TravelerTemplateMode" NOT NULL DEFAULT 'SECTIONS',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "html" TEXT,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "traveler_card_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "traveler_card_templates_isActive_idx" ON "traveler_card_templates"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "traveler_card_templates_name_key" ON "traveler_card_templates"("name");

-- CreateIndex (PARTIAL — yalnız default satır benzersiz)
CREATE UNIQUE INDEX "traveler_card_templates_isDefault_key"
  ON "traveler_card_templates"("isDefault")
  WHERE "isDefault" = true;
