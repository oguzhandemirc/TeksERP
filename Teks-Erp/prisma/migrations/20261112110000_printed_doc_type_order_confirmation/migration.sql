-- Seyitoğlu 3. bölüm L1: sipariş teyidi basılı belge türü (enum SONUNA; ADD VALUE kendi dosyasında — aynı tx değeri kullanamaz).
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'ORDER_CONFIRMATION';
