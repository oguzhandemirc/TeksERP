-- MAL-6: satış teklifi basılı belge türü (enum SONUNA; ADD VALUE kendi dosyasında — aynı tx değeri kullanamaz).
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'SALES_QUOTE';
