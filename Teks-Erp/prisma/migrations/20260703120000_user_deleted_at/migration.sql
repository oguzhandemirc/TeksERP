-- Kullanıcı KALICI SİLME işareti: pasife alma (geri alınabilir) ile silme (geri
-- alınamaz, yalnız geçmiş için durur) ayrımı. NULL = normal kayıt; dolu = silinmiş.
-- (Manuel migration — repo konvansiyonu: psql apply + prisma migrate resolve --applied.)
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMPTZ;
