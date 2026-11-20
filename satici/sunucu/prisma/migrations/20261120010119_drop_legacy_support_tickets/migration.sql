-- YIKICI (kullanıcı onayı 2026-11-20): eski satıcı üzerinden destek talebi sistemi (3d-2) söküldü;
-- yerine Etkili Destek geldi. Talep durum tablosu, olay defteri (tetikleyicisi tabloyla düşer),
-- talep numarası dizisi ve iki enum silinir. BildirimOlayi.DESTEK_TALEBI KALIR (PG enum değeri
-- düşürülemez; geçmiş bildirim kayıtları). DropForeignKey satırları çıkarıldı.

-- DropTable
DROP TABLE IF EXISTS "destek_olayi";

-- DropTable
DROP TABLE IF EXISTS "destek_talebi";

-- DropSequence
DROP SEQUENCE IF EXISTS "destek_talep_no_seq";

-- DropEnum
DROP TYPE IF EXISTS "DestekOlayTuru";

-- DropEnum
DROP TYPE IF EXISTS "DestekDurumu";
