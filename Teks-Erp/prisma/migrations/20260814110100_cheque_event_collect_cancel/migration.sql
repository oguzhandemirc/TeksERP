-- Çek tahsil stornosu için olay tipi (2026-08-14 sağlamlık paketi, K-2).
-- ⚠️ KENDİ DOSYASINDA — ADD VALUE aynı-tx kuralı. Sona, idempotent.
ALTER TYPE "ChequeEventType" ADD VALUE IF NOT EXISTS 'COLLECT_CANCEL';
