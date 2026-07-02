-- Cihaz kaydında KALICI SİLME işareti: pasife alma (geri alınabilir) ile silme
-- (geri alınamaz, yalnız veri bütünlüğü için durur) ayrımı — users.deletedAt kalıbı.
-- NULL = normal kayıt (isActive true=aktif / false=GEÇİCİ pasif); dolu = silinmiş.
-- (Manuel migration — repo konvansiyonu: psql apply + prisma migrate resolve --applied.)
ALTER TABLE "peripheral_devices" ADD COLUMN "deletedAt" TIMESTAMPTZ;
