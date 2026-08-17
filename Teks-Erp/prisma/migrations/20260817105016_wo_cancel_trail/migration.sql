-- İŞ EMRİ İPTAL İZİ (2026-08-17)
-- Sebep şimdiye kadar YALNIZ `system_logs`'a yazılıyordu ve audit 6 ayda bir
-- arşivleniyor → "bu iş emri neden/kim tarafından iptal edildi" sorusunun
-- cevabı altı ay sonra sessizce kayboluyordu. Kalıcı iz kolonda durur.
--
-- ⚠️ `migrate dev` bu diff'e iki DropForeignKey daha eklemişti
-- (`rolls_sackId_shipmentId_consistency_fkey`, `swatches_...`). İkisi de
-- datamodel'de temsil EDİLEMEYEN DEFERRABLE composite FK; Prisma onları her
-- diff'te düşürmek ister. Satırlar bilinçli SİLİNDİ — schema.prisma:2557-2558.

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ,
ADD COLUMN     "cancelledById" UUID;

-- AddForeignKey
-- ON DELETE SET NULL: kullanıcı silinse de iptal kaydı ve sebebi kalır
-- (kim olduğu düşer, "iptal edildi mi" bilgisi düşmez).
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
