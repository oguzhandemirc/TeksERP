-- =============================================================================
-- OrderStatus enum sadeleşmesi — Phase 1
-- =============================================================================
-- READY/SHORT/IN_PRODUCTION kaldırıldı. "Envanter hazır mı?" / "Üretim sürüyor
-- mu?" sorularının cevabı runtime hesabı (allocation + workOrder.status üzerinden);
-- status alanına yazmıyoruz.
--
-- Lifecycle:
--   PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED / CANCELLED
--
-- Mevcut kayıtlardaki READY/SHORT/IN_PRODUCTION değerleri güvenli "APPROVED"
-- statüsüne taşınır (paketleme/sevk hâlâ açık siparişler).
-- =============================================================================

-- 1) Eski statüleri APPROVED'a taşı
UPDATE "orders"
SET "status" = 'APPROVED'
WHERE "status" IN ('READY', 'SHORT', 'IN_PRODUCTION');

-- 2) Yeni enum tipini oluştur (geçici isimle)
CREATE TYPE "OrderStatus_new" AS ENUM (
  'PENDING',
  'APPROVED',
  'PARTIAL_SHIPPED',
  'COMPLETED',
  'CANCELLED'
);

-- 3) orders.status kolonunu yeni enum'a çevir
ALTER TABLE "orders"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "OrderStatus_new"
    USING ("status"::text::"OrderStatus_new"),
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- 4) Eski enum'u sil ve yenisini doğru isme rename et
DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
