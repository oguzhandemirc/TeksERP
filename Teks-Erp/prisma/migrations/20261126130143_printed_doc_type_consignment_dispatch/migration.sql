-- Denetim 6 (2026-11-26): emanet çıkış basılı belge türü (enum SONUNA; ADD VALUE kendi dosyasında — aynı tx değeri kullanamaz).
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'CONSIGNMENT_DISPATCH';
