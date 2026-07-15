-- Prisma-authored diff'ten türetildi; datamodel DIŞI custom raw constraint
-- drop/recreate'leri (sacks_customerId_fkey, rolls/swatches
-- _sackId_shipmentId_consistency_fkey) KASTEN ÇIKARILDI — bkz. 20260713120000_parti_modeli
-- aynı gerekçe. Bu üçü Prisma'nın datamodel'de temsil edemediği raw/composite FK'lar
-- olduğundan her migrate dev'de spurious diff üretiyor; gerçek şema değişikliği yok.

-- AlterEnum
ALTER TYPE "RollEntrySource" ADD VALUE 'MANUAL_ENTRY';
