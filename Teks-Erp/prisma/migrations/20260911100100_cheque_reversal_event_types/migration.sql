-- =============================================================================
-- Çek ters yolları — olay defteri tipleri (defter-öncelikli doktrin, B bölümü)
-- =============================================================================
-- BOUNCED / RETURNED / PAID çıkışsız terminaldi, ENDORSED'ın geri yolu yoktu.
-- Her ileri olayın tipli stornosu `ChequeEventType`a SONA eklenir.
--
-- ⚠️ KENDİ DOSYASINDA — ADD VALUE aynı-tx kuralı. Sona, idempotent.
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

ALTER TYPE "ChequeEventType" ADD VALUE IF NOT EXISTS 'ENDORSE_CANCEL';
ALTER TYPE "ChequeEventType" ADD VALUE IF NOT EXISTS 'BOUNCE_CANCEL';
ALTER TYPE "ChequeEventType" ADD VALUE IF NOT EXISTS 'RETURN_CANCEL';
ALTER TYPE "ChequeEventType" ADD VALUE IF NOT EXISTS 'PAY_CANCEL';
