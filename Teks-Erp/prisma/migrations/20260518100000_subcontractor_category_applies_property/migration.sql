-- =============================================================================
-- SubcontractorCategory.appliesProperty — yeni bayrak
-- =============================================================================
-- Önceden tek `appliesColor` bayrağı hem rengi hem özelliği uyguluyordu.
-- Artık ayrılıyor: appliesColor sadece renk, appliesProperty sadece özellik.
-- Boyahane gibi hem renk hem özellik veren kategoriler için ikisi de true olur.
--
-- Backfill kuralı: appliesColor=true olan tüm kategorilerde
-- appliesProperty=true (mevcut Fason Kabul davranışı korunur).
-- =============================================================================

-- AlterTable
ALTER TABLE "subcontractor_categories" ADD COLUMN "appliesProperty" BOOLEAN NOT NULL DEFAULT false;

-- Data fix: mevcut "renk veren" kategoriler özelliği de uyguluyordu — koru.
UPDATE "subcontractor_categories" SET "appliesProperty" = true WHERE "appliesColor" = true;
