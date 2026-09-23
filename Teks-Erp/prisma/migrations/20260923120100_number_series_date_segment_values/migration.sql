-- Üç yeni tarih segmenti (D5②): DDMMYYYY · MMYY · YYYYMMDD.
--
-- ⚠️ AYRI ve YALNIZ `ADD VALUE` İÇEREN DOSYA — PG, yeni bir enum DEĞERİNİ onu
-- yaratan tx'in içinde KULLANDIRMAZ (55P04). Bu yüzden burada hiçbir
-- INSERT/UPDATE/DEFAULT yok; değerleri kullanan yazma yolu uygulamadadır.
ALTER TYPE "NumberSeriesDateSegment" ADD VALUE IF NOT EXISTS 'DDMMYYYY';
ALTER TYPE "NumberSeriesDateSegment" ADD VALUE IF NOT EXISTS 'MMYY';
ALTER TYPE "NumberSeriesDateSegment" ADD VALUE IF NOT EXISTS 'YYYYMMDD';
