-- =============================================================================
-- `YarnMovementKind` + WARP_RETURN_REVERSAL (2026-09-14, devere Faz 1b · c1 · 4/5)
-- =============================================================================
-- ⚠️ BU DOSYA BİLEREK TEK İFADEDİR. Yeni bir enum DEĞERİ onu yaratan tx'te
--   KULLANILAMAZ (PostgreSQL 55P04 "unsafe use of new value of enum type");
--   Prisma her migration dosyasını tek tx'te koşar ⇒ değeri kullanan hiçbir
--   ifade (INSERT · UPDATE · DEFAULT · CHECK · CAST) buraya GİRMEZ. Kolon ve
--   CHECK'ler c2'nin tablo migration'ında. Emsal: 20260913242000 (MACHINE_STOP).
-- ⛔ GERİ ALINAMAZ: PostgreSQL enum değeri düşürmeyi desteklemez.
ALTER TYPE "YarnMovementKind" ADD VALUE IF NOT EXISTS 'WARP_RETURN_REVERSAL';
