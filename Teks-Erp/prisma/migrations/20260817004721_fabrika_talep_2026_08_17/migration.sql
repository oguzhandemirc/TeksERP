-- Fabrika talep listesi 2026-08-17
--   · madde 9  → yarı mamül girişini ham girişten ayıran enum değeri
--   · madde 11 → "fasona renksiz git" işareti (rota şablonu + iş emri adımı)
--
-- ⚠️ `migrate dev` bu diff'e iki DropForeignKey satırı daha eklemişti
-- (`rolls_sackId_shipmentId_consistency_fkey`, `swatches_...`). İkisi de
-- datamodel'de temsil EDİLEMEYEN DEFERRABLE composite FK'lar; Prisma onları
-- her diff'te düşürmek ister. Satırlar bilinçli olarak SİLİNDİ —
-- bkz. schema.prisma:2557-2558 ve CLAUDE.md "sacks composite FK drift'i".

-- AlterEnum
ALTER TYPE "RollEntrySource" ADD VALUE 'SEMI_FINISHED';

-- AlterTable
ALTER TABLE "route_steps" ADD COLUMN     "dispatchWithoutColor" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "work_order_steps" ADD COLUMN     "dispatchWithoutColor" BOOLEAN NOT NULL DEFAULT false;
