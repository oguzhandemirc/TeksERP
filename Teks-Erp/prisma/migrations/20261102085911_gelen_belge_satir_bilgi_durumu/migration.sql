-- =============================================================================
-- Gülkesim parti no + kurşun metresi S0 (2026-11-02): gelen belge satırına `INFO` durumu
-- =============================================================================
-- Belge başına tek kayıt kipinde (`gelenBelge.entryMode=PER_DOCUMENT`) belgedeki satırlar topsuz BİLGİ olur.
-- ⚠️ KENDİ DOSYASINDA (deploy-kurulum kuralı, R7): PG'de ADD VALUE ile eklenen değer AYNI transaction'da
-- KULLANILAMAZ (55P04). Bu dosya değeri yalnız tanımlar; değeri yazan onay dilimidir (S0'da yazan yok).
-- `IF NOT EXISTS` ile idempotent. GÜVENLİ: yalnız EKLEME — mevcut satırlara dokunmaz.
-- =============================================================================

ALTER TYPE "DeliveryNoteLineStatus" ADD VALUE IF NOT EXISTS 'INFO';
