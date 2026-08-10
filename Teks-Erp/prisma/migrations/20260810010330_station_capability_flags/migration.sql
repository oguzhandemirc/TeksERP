-- NOT: Prisma'nın ürettiği iki `DropForeignKey` satırı BİLİNÇLİ olarak silindi
-- (DEFERRABLE composite FK'lar datamodel'de temsil edilemiyor). Bkz.
-- schema.prisma → sacks notu ve CLAUDE.md "sacks composite FK drift'i".

-- AlterTable
ALTER TABLE "stations" ADD COLUMN     "appliesColor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "appliesProperty" BOOLEAN NOT NULL DEFAULT true;

-- Mevcut satırların DOLDURULMASI (bugünkü davranışı BİREBİR korur):
--   • EXTERNAL + kategori var  → kategoriden kopyala
--   • diğer her istasyon       → appliesColor=false (kolon varsayılanı)
--
-- ⚠️ İç istasyonlara appliesColor=TRUE yazmak SESSİZ bir davranış değişikliği
-- olurdu: eski kural `hasDefaultCategory && canApplyColor` bileşiğiydi ve
-- kategorisiz istasyonda sonuç FALSE'tu. TRUE yazmak Tambur/Kurşun adımına
-- renk atanmasına izin verirdi.
--
-- `appliesProperty` kolon varsayılanı zaten TRUE (eski `canApplyProperty`
-- kategorisiz istasyonda true üretiyordu); kategorisi olan istasyonlarda
-- kategorinin bayrağına çekilir.
UPDATE "stations" s
SET "appliesColor"    = c."appliesColor",
    "appliesProperty" = c."appliesProperty"
FROM "subcontractor_categories" c
WHERE s."defaultCategoryId" = c."id";
