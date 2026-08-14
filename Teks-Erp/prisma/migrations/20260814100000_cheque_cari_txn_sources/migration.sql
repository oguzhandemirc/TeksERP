-- =============================================================================
-- Çek/senet — cari defter kaynakları (C1 · M1, 2026-08-14)
-- =============================================================================
-- `CariTxnSource` enum'una SONA beş değer. Çekin cari deftere DOKUNDUĞU beş anı
-- adlandırırlar; tahsil (COLLECT) ve kendi çekimizin ödenmesi (PAY) burada YOK,
-- çünkü o anlarda yalnız banka/kasa bakiyesi oynar (cari ikinci kez hareket
-- görseydi aynı borç iki kez kapanmış sayılırdı).
--
-- ⚠️ NEDEN KENDİ MIGRATION'I: PG'de `ALTER TYPE ... ADD VALUE` ile eklenen değer
-- AYNI transaction içinde KULLANILAMAZ. Bu yüzden çek TABLOLARINDAN (M2) ayrı
-- ve ONDAN ÖNCE koşar. Emsal: 20260813200000_currency_rub ve
-- 20260814090000_finance_doc_types.
--
-- ⚠️ `IF NOT EXISTS`: yarıda kalan bir uygulamada migration tekrar koşabilsin.
-- (20260813150000 bunu atlamıştı ve tekrar denenemiyordu.)
--
-- ⚠️ FABRİKAYA ETKİSİ SIFIR: enum'a değer eklemek mevcut satırlara dokunmaz,
-- tabloyu yeniden yazmaz, hiçbir sorgu planını değiştirmez. Bu değerleri yazan
-- yüzeylerin tamamı `finance.enabled` rejiminin arkasında.
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CHEQUE_RECEIVE';
ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CHEQUE_ISSUE';
ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CHEQUE_ENDORSE';
ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CHEQUE_BOUNCE';
ALTER TYPE "CariTxnSource" ADD VALUE IF NOT EXISTS 'CHEQUE_CANCEL';
