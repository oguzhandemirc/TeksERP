-- =============================================================================
-- SİPARİŞ SATIRI TOLERANSI — `order_lines.tolerancePct` (Seyitoğlu 2. bölüm K4, 2026-11-11)
-- ADDITIVE: tek NULLABLE kolon + CHECK 0..50; veri yazmaz. NULL = satır toleransı yok (bugünkü davranış).
-- =============================================================================
-- Dolu satır siparişin sevk tamamlanma toleransına katılır (`recomputeOrderStatusTx`: fabrika
-- `shipping.toleranceMeters` + Σ aktif metre satırı × %/100). Gerekçe arşivde (2026-11 "satır toleransı").
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.

ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "tolerancePct" DECIMAL(5,2);

ALTER TABLE "order_lines" DROP CONSTRAINT IF EXISTS "order_lines_tolerance_pct_range";
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tolerance_pct_range"
  CHECK ("tolerancePct" IS NULL OR ("tolerancePct" >= 0 AND "tolerancePct" <= 50));
