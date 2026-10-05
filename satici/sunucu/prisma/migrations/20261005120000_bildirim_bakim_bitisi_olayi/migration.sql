-- YALNIZ enum değeri ekler (ayrı dosya: PG yeni değeri onu ekleyen tx'te kullandırmaz, 55P04). Geri alınamaz
-- (PG değer düşürmez); mevcut satırların anlamı değişmez.
--   BAKIM_BITISI_YAKLASIYOR — HAK bakım bitişine ≤ 30 gün: yenileme satışı için (bitiş değişirse yeni dönem)
ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'BAKIM_BITISI_YAKLASIYOR';
