-- =============================================================================
-- `WarpBeamOrigin` + CONSIGNED (G3 emanet, 1/3 — 2026-09-15, 01)
-- =============================================================================
-- ⚠️ YALNIZ ADD VALUE (55P04); kolon/CHECK 20260915052000'de. Müşterinin EMANET leventi —
--   taraf kolonu `ownerCustomerId` (supplierId'e BİNDİRİLMEZ, DEVERE-LEVENT-TARAMASI §3.9). İdempotent, GERİ ALINAMAZ.
ALTER TYPE "WarpBeamOrigin" ADD VALUE IF NOT EXISTS 'CONSIGNED';
