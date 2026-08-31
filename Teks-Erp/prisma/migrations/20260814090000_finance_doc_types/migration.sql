-- =============================================================================
-- Ön muhasebe çıktıları — iki yeni belge tipi (2026-08-14)
-- =============================================================================
-- `PrintedDocType` enum'una SONA iki değer: iç fatura + tahsilat/ödeme makbuzu.
--
-- ⚠️ AYRI MIGRATION olmasının sebebi PG kuralıdır: `ALTER TYPE ... ADD VALUE` ile
-- eklenen değer AYNI transaction içinde KULLANILAMAZ. Bu değerleri kullanan
-- hiçbir DML burada yok (builder/renderer uygulama katmanında), dolayısıyla
-- güvenli — ama yeni bir değer eklerken aynı kuralı hatırla.
--
-- ⚠️ `IF NOT EXISTS`: bir önceki emsal (20260813150000) onu kullanmamıştı ve
-- yarıda kalan bir uygulamada migration tekrar koşturulamıyordu. Ekleme
-- idempotent olmalı — bu migration'ın kendisi dışında hiçbir yerde tekrar
-- denemenin maliyeti yok.
--
-- ⚠️ FABRİKAYA ETKİSİ SIFIR: enum'a değer eklemek mevcut satırlara dokunmaz,
-- tabloyu yeniden yazmaz. Yeni tipleri üreten yüzeyler `finance.enabled`
-- rejiminin arkasında.
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'INVOICE_INTERNAL';
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIPT';
