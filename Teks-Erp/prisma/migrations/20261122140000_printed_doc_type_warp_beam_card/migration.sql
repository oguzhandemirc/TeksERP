-- Devere S5 (2026-11-22): levent kartı (A6, iç belge) basılı belge türü (enum SONUNA; ADD VALUE kendi dosyasında — aynı tx değeri kullanamaz).
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'WARP_BEAM_CARD';
