-- Devere S6 (2026-11-22): devereci gövde mutabakatı basılı belge türü (enum SONUNA; ADD VALUE kendi dosyasında — aynı tx değeri kullanamaz).
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'BEAM_BODY_STATEMENT';
