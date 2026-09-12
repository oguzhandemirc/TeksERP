-- =============================================================================
-- WarehouseEventType — stok defterinin beş yeni olayı (tasarım §D2)
-- =============================================================================
-- PRODUCTION (üretim karşı tarafı) · EXTERNAL (fason/kartela) · TRANSFORM (aynı
-- depoda 1:N bölünme, grup net sıfır) · ADJUST (fire/sayım/çekme/aşım) ·
-- OPENING_BALANCE (kesme anı fotoğrafı).
--
-- ⚠️ Yön ENUM'A GİRMEZ: yönü `fromWarehouseId`/`toWarehouseId` taşır ve sunucu
-- türetir (aynı satır iki depoda zıt yön basar). Ters kayıt da yeni değer AÇMAZ —
-- `reversesMovementId` bağıyla ifade edilir.
--
-- ⚠️ Değeri KULLANAN hiçbir ifade bu dosyada YOK (PG 55P04: yeni enum değeri aynı
-- transaction'da kullanılamaz).
-- =============================================================================

ALTER TYPE "WarehouseEventType" ADD VALUE IF NOT EXISTS 'PRODUCTION';
ALTER TYPE "WarehouseEventType" ADD VALUE IF NOT EXISTS 'EXTERNAL';
ALTER TYPE "WarehouseEventType" ADD VALUE IF NOT EXISTS 'TRANSFORM';
ALTER TYPE "WarehouseEventType" ADD VALUE IF NOT EXISTS 'ADJUST';
ALTER TYPE "WarehouseEventType" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';
