-- =============================================================================
-- WarehouseEventType += CANCEL_REVERSAL — iptalin ters kaydı (defter doktrini)
-- =============================================================================
-- `CANCEL` "top depodan düştü" der; ters yolu yoktu. İlk yazarı sayım stornosu
-- (`stock-count.service` reverse): bulunamadı diye düşülen top rafına dönerken
-- depo defterine karşı satır yazılır.
--
-- ⚠️ TEK İFADE: PG, aynı tx'te eklenen enum değerinin kullanılmasına izin vermez
-- (55P04) — değeri kullanan hiçbir ifade bu dosyaya konmaz. `IF NOT EXISTS`
-- ikinci koşumu no-op yapar. Enum değeri geri ALINAMAZ (PG değer düşürmez).
-- =============================================================================

ALTER TYPE "WarehouseEventType" ADD VALUE IF NOT EXISTS 'CANCEL_REVERSAL';
