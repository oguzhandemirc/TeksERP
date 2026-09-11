-- =============================================================================
-- Çek ters yolları — cari defter kaynakları (defter-öncelikli doktrin, B bölümü)
-- =============================================================================
-- Ciro / karşılıksız / iade kayıtlarının cari satırları tipli ters satırla
-- geri alınabilsin diye `CariTxnSource`a SONA üç değer.
--
-- ⚠️ KENDİ DOSYASINDA: PG'de ADD VALUE ile eklenen değer AYNI transaction'da
-- KULLANILAMAZ (20260814100000_cheque_cari_txn_sources emsali). `IF NOT EXISTS`
-- ile idempotent.
--
-- GÜVENLİ: yalnız EKLEME — mevcut satırlara dokunmaz, tabloyu yeniden yazmaz.
-- =============================================================================

ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CHEQUE_ENDORSE_CANCEL';
ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CHEQUE_BOUNCE_CANCEL';
ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CHEQUE_RETURN_CANCEL';
