-- Lisans v2 · L2-4 (ödenmiş tarih · kapanış kirası · yerel müdahale) — YALNIZ enum değeri ekler.
-- AYRI dosya: PG yeni enum değerini onu ekleyen tx'te kullandırmaz (55P04); değeri KULLANAN ifade (CHECK) bir
-- sonraki migration'dadır. `IF NOT EXISTS`: defter dışında açılmış değer deploy'u yarıda bırakmasın. Geri alınamaz
-- (PG değer düşürmez); mevcut satırların anlamı değişmez.
ALTER TYPE "ZincirKarari" ADD VALUE IF NOT EXISTS 'KAPANIS';
ALTER TYPE "ZincirKarari" ADD VALUE IF NOT EXISTS 'DOSYA';
ALTER TYPE "KopyaUyariTuru" ADD VALUE IF NOT EXISTS 'YABANCI_HAK';
ALTER TYPE "KopyaUyariTuru" ADD VALUE IF NOT EXISTS 'YEREL_MUDAHALE';
ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'YEREL_MUDAHALE_SUPHESI';
