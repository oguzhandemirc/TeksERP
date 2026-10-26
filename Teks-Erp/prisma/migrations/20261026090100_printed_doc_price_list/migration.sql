-- MAL-6: fiyat listesi basılı belge türü (enum SONUNA; ADD VALUE kendi dosyasında).
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'PRICE_LIST';
