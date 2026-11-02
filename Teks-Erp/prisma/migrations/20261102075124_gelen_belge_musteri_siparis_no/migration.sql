-- S2(b) 2026-11-02: gelen belge başlığına müşterinin basılı "Sipariş No"su (OCR ilk bloğun değeri, elle düzeltilebilir).
-- ADDITIVE: yalnız nullable kolon; mevcut satırlar NULL kalır (bugünkü davranış), veri göçü yok.
-- Index YOK: liste araması `contains` (ILIKE '%…%') — btree kullanılmaz; kardeş kolonlar (senderDocNo, customerBatchNo) da indexsiz.

ALTER TABLE "customer_delivery_notes" ADD COLUMN IF NOT EXISTS "customerOrderNo" VARCHAR(64);
