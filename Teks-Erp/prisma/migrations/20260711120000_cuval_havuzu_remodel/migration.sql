-- ÇUVAL HAVUZU REMODELİ (Sevkiyat "B modeli")
-- Sack müşteriye ait birinci sınıf havuz varlığı olur; ShipmentAllocation → SackAllocation
-- (çuval bazlı karşılanma defteri); ShipmentStatus PREPARING/READY → PLANNED.
-- NOT: Bu migration boş DB üzerinde (migrate reset) oynatılacak biçimde yazılmıştır —
-- veri dönüşümü yoktur (tüm veriler test verisi; reset + reseed).
SET statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1) OrderLine / Order — packedQty (çuvallanmış rezerv denorm'u)
-- ---------------------------------------------------------------------------
ALTER TABLE "order_lines" ADD COLUMN "packedQty" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "orders"      ADD COLUMN "packedQty" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2) Sack — müşteri sahipliği + mühür + havuz index'leri
-- ---------------------------------------------------------------------------
ALTER TABLE "sacks" ADD COLUMN "customerId" UUID;
ALTER TABLE "sacks" ADD COLUMN "branchId"   UUID;
ALTER TABLE "sacks" ADD COLUMN "sealedAt"   TIMESTAMP(3);
ALTER TABLE "sacks" ADD COLUMN "sealedById" UUID;
-- Boş DB'de mevcut satır yok → customerId doğrudan NOT NULL yapılabilir.
ALTER TABLE "sacks" ALTER COLUMN "customerId" SET NOT NULL;
-- seq artık nullable (havuz çuvalları seq=NULL) — default kalkar.
ALTER TABLE "sacks" ALTER COLUMN "seq" DROP DEFAULT;
ALTER TABLE "sacks" ALTER COLUMN "seq" DROP NOT NULL;

-- Sevkiyat-içi (shipmentId, manualCode) unique KALKAR — havuzda shipmentId NULL, koruma sağlamaz.
DROP INDEX IF EXISTS "sacks_shipmentId_manualCode_idx";

-- manualCode GLOBAL benzersiz — AMB-regex partial'dan tam "IS NOT NULL"a genişletilir.
DROP INDEX IF EXISTS "sacks_manualCode_idx";
CREATE UNIQUE INDEX "sacks_manualCode_idx" ON "sacks" ("manualCode") WHERE "manualCode" IS NOT NULL;

-- Havuz sorguları: müşteri + mühür durumu/sırası.
CREATE INDEX "sacks_customerId_sealedAt_idx" ON "sacks" ("customerId", "sealedAt");

ALTER TABLE "sacks" ADD CONSTRAINT "sacks_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_sealedById_fkey"
  FOREIGN KEY ("sealedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3) SackAllocation (yeni) — çuval bazlı karşılanma defteri
-- ---------------------------------------------------------------------------
CREATE TABLE "sack_allocations" (
  "id"          UUID NOT NULL,
  "sackId"      UUID NOT NULL,
  "orderLineId" UUID NOT NULL,
  "qty"         DECIMAL(12,3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sack_allocations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sack_allocations_sackId_orderLineId_key" ON "sack_allocations" ("sackId", "orderLineId");
CREATE INDEX "sack_allocations_orderLineId_idx" ON "sack_allocations" ("orderLineId");
ALTER TABLE "sack_allocations" ADD CONSTRAINT "sack_allocations_sackId_fkey"
  FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sack_allocations" ADD CONSTRAINT "sack_allocations_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4) ShipmentAllocation (eski) — DROP (yerini SackAllocation aldı)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "shipment_allocations";

-- ---------------------------------------------------------------------------
-- 5) Shipment — readyAt/readyById kalkar
-- ---------------------------------------------------------------------------
ALTER TABLE "shipments" DROP CONSTRAINT IF EXISTS "shipments_readyById_fkey";
ALTER TABLE "shipments" DROP COLUMN IF EXISTS "readyAt";
ALTER TABLE "shipments" DROP COLUMN IF EXISTS "readyById";

-- ---------------------------------------------------------------------------
-- 6) ShipmentStatus enum — PREPARING/READY çıkar, PLANNED ekle (remove_paused deseni)
-- ---------------------------------------------------------------------------
ALTER TABLE "shipments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "ShipmentStatus" RENAME TO "ShipmentStatus_old";
CREATE TYPE "ShipmentStatus" AS ENUM ('PLANNED', 'AT_DOOR', 'DISPATCHED', 'CANCELLED');
ALTER TABLE "shipments" ALTER COLUMN "status" TYPE "ShipmentStatus" USING ("status"::text::"ShipmentStatus");
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'PLANNED';
DROP TYPE "ShipmentStatus_old";

-- ---------------------------------------------------------------------------
-- 7) ShipmentOrder — "bir sipariş tek aktif sevkiyatta" partial unique KALKAR
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "shipment_orders_active_order_uq";
