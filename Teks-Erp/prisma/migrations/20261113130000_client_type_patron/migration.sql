-- Patron telefon uygulaması kendi oturum yuvasını alır (V1, 2026-11-13): MOBILE'a katlansaydı aynı kişinin
-- tablet oturumunu düşürürdü. ADDITIVE; ADD VALUE kendi dosyasında (aynı tx değeri kullanamaz, PG 55P04).
ALTER TYPE "ClientType" ADD VALUE IF NOT EXISTS 'PATRON';
