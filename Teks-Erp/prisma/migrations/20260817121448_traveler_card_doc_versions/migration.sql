-- Refakat kartı versiyon geçmişi (2026-08-17)
-- Basılan her kart sürümü `printed_documents` defterine donar; YENİ TABLO AÇILMADI.
-- sourceId = TravelerCard.id (iş emri belge listesinin zaten kullandığı kimlik).
--
-- ⚠️ `migrate dev`in ürettiği iki `DropForeignKey` satırı ELLE SİLİNDİ:
-- `rolls_sackId_shipmentId_consistency_fkey` + `swatches_...` datamodel'de
-- temsil edilemeyen DEFERRABLE composite FK'lardır ve her diff'te düşürülmek
-- istenir (bkz. schema.prisma:2557-2558 / CLAUDE.md perf kuralı 4).

-- AlterEnum
ALTER TYPE "PrintedDocType" ADD VALUE 'TRAVELER_CARD';
