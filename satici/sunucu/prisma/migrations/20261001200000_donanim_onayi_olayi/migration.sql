-- Lisans v2 · L2-11 (parmak izi K8) — YALNIZ enum değeri ekler (ayrı dosya: PG yeni değeri onu ekleyen tx'te
-- kullandırmaz, 55P04). Geri alınamaz (PG değer düşürmez); mevcut satırların anlamı değişmez.
--   DONANIM_ONAYI_BEKLIYOR — donanım değişikliği ya da zayıf tanıma portal onayı bekliyor
ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'DONANIM_ONAYI_BEKLIYOR';
