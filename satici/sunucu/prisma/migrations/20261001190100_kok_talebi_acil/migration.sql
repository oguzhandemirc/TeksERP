-- Lisans v2 · genişlik kapısı — kök imzası talebine ACİL bayrağı (YALNIZ ekler; mevcut talepler acil değil).
-- Yetenek düşüşünde fabrikanın elinde güncelden geniş olmayan HAK yoksa kira verilmez ve talep acil işaretlenir.
ALTER TABLE "hak_kok_talebi" ADD COLUMN "acil" BOOLEAN NOT NULL DEFAULT false;
