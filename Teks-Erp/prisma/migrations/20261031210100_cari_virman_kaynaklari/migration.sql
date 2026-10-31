-- =============================================================================
-- K3d (D4-SEMA; kullanıcı kararı 2026-10-30): CARİ VİRMAN defter kaynakları
-- =============================================================================
-- Hareketli çift cari hesabın bakiyesi survivor'a VİRMANLA aktarılır (geçmiş taşınmaz);
-- `CariTxnSource`a SONA iki değer: ileri (`CARI_TRANSFER`) + tipli ters (`CARI_TRANSFER_CANCEL`).
--
-- ⚠️ KENDİ DOSYASINDA: PG'de ADD VALUE ile eklenen değer AYNI transaction'da
-- KULLANILAMAZ — CHECK'ler bir sonraki migration'da (20261031210200). `IF NOT EXISTS` ile idempotent.
-- GÜVENLİ: yalnız EKLEME — mevcut satırlara dokunmaz.
-- =============================================================================

ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CARI_TRANSFER';
ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CARI_TRANSFER_CANCEL';
