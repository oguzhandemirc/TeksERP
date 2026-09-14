-- =============================================================================
-- `WarpBeamStatus` + SHIPPED_OUT (2026-09-14, polimorfik fason sevk kalemi F1 · 1/2)
-- =============================================================================
-- ⚠️ BU DOSYA BİLEREK TEK İFADEDİR. Yeni bir enum DEĞERİ onu yaratan tx'te
--   KULLANILAMAZ (PostgreSQL 55P04); Prisma her migration dosyasını tek tx'te
--   koşar ⇒ değeri kullanan ifadeler (partial index yüklemi · CHECK) 171000'de.
--   Emsal: 20260914120300 (WARP_RETURN_REVERSAL).
-- ⛔ GERİ ALINAMAZ: PostgreSQL enum değeri düşürmeyi desteklemez.
ALTER TYPE "WarpBeamStatus" ADD VALUE IF NOT EXISTS 'SHIPPED_OUT';
