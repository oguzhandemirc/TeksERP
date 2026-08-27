-- SİPARİŞ İPTAL İZİ: ne zaman, neden (2026-08-26)
--
-- `cancelledAt` — `completedAt`in ikizi. "Dönemde kaç sipariş iptal oldu"
-- sorusu `orderDate`e sorulamaz: sipariş Ocak'ta alınıp Mart'ta iptal edilebilir
-- ve iki soru farklı aylara aittir.
--
-- `cancelReason`     GÖRÜNEN metin (hazır satır ya da serbest yazı).
-- `cancelReasonCode` RAPOR ANAHTARI — kod ASLA değişmez, etiket serbesttir
--   (ReasonPreset düzeni). Kodu SUNUCU türetir (`resolveReasonCode`); serbest
--   metinde NULL kalır ve UYDURULMAZ.
--
-- Index BİLİNÇLİ YOK: rapor sorgusu `status = 'CANCELLED'` eşitliğiyle başlar,
-- mevcut `(status, createdAt DESC)` bileşiği o daralmayı zaten veriyor.
-- Geçmiş 4 iptal kaydında bu alanlar NULL kalır — geriye dönük uydurulmaz.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "cancelledAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "cancelReason"     TEXT,
  ADD COLUMN IF NOT EXISTS "cancelReasonCode" VARCHAR(64);
