-- Seyitoğlu K1: desen kartında tahar türü (Düz · Sivri · Atlamalı · Özel) — yalnız EKLEME.
-- Tip bu migration'da DOĞUYOR (CREATE TYPE + kullanım aynı dosyada serbest; ADD VALUE değil).
-- Eski kayıt NULL alır = bilinmiyor (düz tahar varsayılır, bugünkü görünüm); `drawingInNote` aynen kalır.
CREATE TYPE "WeaveDrawingInType" AS ENUM ('STRAIGHT', 'POINTED', 'SKIP', 'CUSTOM');

ALTER TABLE "weave_designs" ADD COLUMN "drawingInType" "WeaveDrawingInType";
