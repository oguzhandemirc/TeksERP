-- Sevkiyatın PLANLANAN SEVK GÜNÜ (cari-be madde 4, 2026-11-13). ADDITIVE: NULL kolon, mevcut satır
-- değişmez (NULL = tarih verilmedi, bugünkü davranış). Takvim günü → DATE (timestamptz değil;
-- `test_timestamptz_contract` DATE_ONLY envanterinde). Pano ajandası planlı sevkiyatı bu güne koyar.
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "plannedDate" DATE;
