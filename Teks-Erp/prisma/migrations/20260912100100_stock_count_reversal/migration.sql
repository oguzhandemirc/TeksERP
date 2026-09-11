-- =============================================================================
-- Sayım (StockCount) stornosu — COMPLETED artık terminal değil (defter doktrini)
-- =============================================================================
-- Yanlış "bulunamadı" işaretiyle tamamlanan sayım N topu iptal ediyordu ve tek
-- çıkış yolu top-top elle geri almaydı (o yol da depo/sapma defterine ters satır
-- yazmıyor). Storno fark fişini TEK BELGEDE ters kayıtla geri alır; sayım satırı
-- ve ileri defter satırları DEĞİŞMEZ, başlığa damga yazılır.
--
-- GÜVENLİ: üç NULLABLE kolon; tablo yeniden yazımı yok. `status` COMPLETED kalır.
-- =============================================================================

ALTER TABLE "stock_counts" ADD COLUMN IF NOT EXISTS "reversedAt"    TIMESTAMPTZ;
ALTER TABLE "stock_counts" ADD COLUMN IF NOT EXISTS "reversedById"  UUID;
ALTER TABLE "stock_counts" ADD COLUMN IF NOT EXISTS "reverseReason" VARCHAR(300);
