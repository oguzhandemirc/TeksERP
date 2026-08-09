-- NOT: üretilen dosyadaki iki DropForeignKey satırı ELLE SİLİNDİ
-- (rolls/swatches composite FK'ları datamodel'de temsil edilemiyor → her diff'te
-- spurious DROP üretiyorlar). Kural: schema.prisma:2557-2558.

-- Sapma satırı SİLİNMEZ, terslendiğinde işaretlenir (append-only defter).
-- Nullable kolonlar → metadata-only, tablo yeniden yazılmaz.
-- AlterTable
ALTER TABLE "roll_variances" ADD COLUMN     "reversedAt" TIMESTAMPTZ,
ADD COLUMN     "reversedById" UUID;

-- AddForeignKey
ALTER TABLE "roll_variances" ADD CONSTRAINT "roll_variances_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
