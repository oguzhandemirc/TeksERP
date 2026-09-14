-- =============================================================================
-- Çek bankaya verme stornosu — olay defteri tipi (defter-öncelikli doktrin, SINIF 2)
-- =============================================================================
-- DEPOSIT, ChequeEventType'ın `*_CANCEL` çifti olmayan TEK eylem değeriydi: AT_BANK'tan
-- PORTFOLIO'ya dönüş yalnız COLLECT_CANCEL üzerinden mümkündü, yani yanlış bankaya
-- verilen çek tahsil edilmeden geri alınamıyordu.
--
-- ⚠️ KENDİ DOSYASINDA — ADD VALUE aynı-tx kuralı. Sona, idempotent.
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

ALTER TYPE "ChequeEventType" ADD VALUE IF NOT EXISTS 'DEPOSIT_CANCEL';
