-- Etiket tanımlarında (boyut profili + şablon) KALICI SİLME işareti — users/
-- peripheral_devices.deletedAt kalıbı: pasife alma (geri alınabilir) ile silme
-- (geri alınamaz, yalnız veri bütünlüğü için durur) ayrımı. NULL = normal kayıt.
-- (Manuel migration — psql apply + prisma migrate resolve --applied.)
ALTER TABLE "label_format_profiles" ADD COLUMN "deletedAt" TIMESTAMPTZ;
ALTER TABLE "label_templates" ADD COLUMN "deletedAt" TIMESTAMPTZ;
