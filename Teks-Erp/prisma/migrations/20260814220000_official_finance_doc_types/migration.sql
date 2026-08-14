-- =============================================================================
-- Resmi ön muhasebe belgeleri — iki yeni belge tipi (2026-08-15, J2 #18)
-- =============================================================================
-- `PrintedDocType` enum'una SONA iki değer: cari mutabakat mektubu + çek/senet
-- teslim bordrosu.
--
-- ⚠️ AYRI MIGRATION olmasının sebebi PG kuralıdır: `ALTER TYPE ... ADD VALUE`
-- ile eklenen değer AYNI transaction içinde KULLANILAMAZ. Bu değerleri kullanan
-- hiçbir DML burada yok (builder/renderer uygulama katmanında) — ama bir sonraki
-- migration (20260814220100) tabloları kurarken bu kural yine hatırlanmalı:
-- oradaki tablolar da bu enum değerlerini KULLANMAZ, yalnız kendi durum
-- enum'larını kurarlar.
--
-- ⚠️ `IF NOT EXISTS`: ekleme idempotent olmalı — yarıda kalan bir uygulamada
-- migration tekrar koşturulabilsin (20260814090000 emsali).
--
-- ⚠️ FABRİKAYA ETKİSİ SIFIR: enum'a değer eklemek mevcut satırlara dokunmaz,
-- tabloyu yeniden yazmaz. Yeni tipleri üreten yüzeyler `finance.enabled`
-- rejiminin arkasında.
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_LETTER';
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'CHEQUE_DELIVERY_NOTE';
