-- Devir stornosu için tipli kaynak (2026-08-14 sağlamlık paketi, Sınıf 2).
-- ⚠️ KENDİ DOSYASINDA: PG'de ADD VALUE ile eklenen değer AYNI transaction'da
-- KULLANILAMAZ (20260814100000_cheque_cari_txn_sources emsali).
-- `IF NOT EXISTS` ile idempotent; SONA eklenir.
ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_CANCEL';
