-- Lisans v2 · genişlik kapısı (yetenek düşüşü) — YALNIZ enum değeri ekler (ayrı dosya: PG yeni değeri onu ekleyen
-- tx'te kullandırmaz, 55P04). Geri alınamaz (PG değer düşürmez); mevcut satırların anlamı değişmez.
--   KOK_IMZASI_ACIL — yeteneksiz fabrika kira alamadı: güncel şartların kök imzası tören beklenmeden gerekli
ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'KOK_IMZASI_ACIL';
