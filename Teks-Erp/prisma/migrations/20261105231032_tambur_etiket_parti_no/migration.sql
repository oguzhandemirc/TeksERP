-- Tambur etiket parti no (Gülkesim 2026-11-06): müşterinin etikete istediği parti metni
-- top başına (Roll.labelBatchNo) + cari düzeyi aç/kapa (varsayılan KAPALI = bugünkü davranış).
-- Ek + nullable/varsayılanlı kolonlar; mevcut satırlara dokunmaz.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tamburLabelBatchEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "labelBatchNo" VARCHAR(64);
