-- =============================================================================
-- Ticaret paketi — iki yeni belge tipi (2026-08-13)
-- =============================================================================
-- `PrintedDocType` enum'una SONA iki değer: transfer irsaliyesi + mal kabul fişi.
--
-- ⚠️ AYRI MIGRATION olmasının sebebi PG kuralıdır: `ALTER TYPE ... ADD VALUE` ile
-- eklenen değer AYNI transaction içinde KULLANILAMAZ. Bu değerleri kullanan
-- hiçbir DML burada yok (builder/renderer uygulama katmanında), dolayısıyla
-- güvenli — ama yeni bir değer eklerken aynı kuralı hatırla.
--
-- GÜVENLİ: yalnız EKLEME. Mevcut satırlara dokunulmaz, tablo yeniden yazılmaz.
-- =============================================================================

ALTER TYPE "PrintedDocType" ADD VALUE 'TRANSFER_DISPATCH';
ALTER TYPE "PrintedDocType" ADD VALUE 'GOODS_RECEIPT';
