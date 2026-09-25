-- ÇEK TESLİM BORDROSU İDEMPOTENCY (2026-09-26, K1): resmî bordro oluşturma ucu `clientToken` taşır.
--
-- ADDITIVE: yalnız ekler. Eski satırlar NULL kalır (backfill yok — geçmiş denemenin kimliği yoktur);
-- UNIQUE NULL'ları çakıştırmaz. Eski panel token göndermez ve bugünkü gibi çalışır.
-- İDEMPOTENT (RECETELER migration 11): ikinci koşum sessiz geçer.
ALTER TABLE "cheque_delivery_notes" ADD COLUMN IF NOT EXISTS "clientToken" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "cheque_delivery_notes_clientToken_key" ON "cheque_delivery_notes"("clientToken");
