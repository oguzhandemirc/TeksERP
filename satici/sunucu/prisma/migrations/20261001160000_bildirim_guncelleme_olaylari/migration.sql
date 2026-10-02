-- Dağıtım v2 (D7): bildirim kataloğuna sunucu güncellemesi olayları — yoklama raporundaki tamamlanan deneme
-- (`guncelleme.son`) defter satırıyla AYNI tx'te bir kez bildirilir. Yalnız EKLER (enum değeri); idempotent.
ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'GUNCELLEME_TAMAMLANDI';
ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'GUNCELLEME_GERI_DONDU';
ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'GUNCELLEME_BASARISIZ';
