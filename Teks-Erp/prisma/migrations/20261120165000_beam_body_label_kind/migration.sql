-- =============================================================================
-- DEVERE EK B1 — LabelKind += BEAM_BODY (2026-11-20)
-- =============================================================================
-- YALNIZ `ALTER TYPE … ADD VALUE IF NOT EXISTS`: yeni değer aynı tx'te kullanılamaz (PG 55P04); kullanan
-- kod/veri sonraki dosyalarda. Levent gövdesi etiketi — QR değeri `BeamBody.bodyNo`. Mevcut satırlar değişmez.
-- =============================================================================

ALTER TYPE "LabelKind" ADD VALUE IF NOT EXISTS 'BEAM_BODY';
