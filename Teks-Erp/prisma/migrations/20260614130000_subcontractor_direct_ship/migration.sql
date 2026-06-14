-- =============================================================================
-- Fasondan Doğrudan Sevk (Direct Ship from Subcontractor)
-- =============================================================================
-- Fason fiilen son durak olduğunda (mal fabrikaya dönmeden fasondan doğrudan
-- müşteriye sevk) operatörün manuel kapatması için:
--   1) SubcontractorDispatch'e doğrudan-sevk işareti (cancelledAt üçlüsüne paralel)
--   2) Opsiyonel karşılanma kaydı tablosu (ShipmentAllocation'ın dispatch-merkezli
--      kardeşi — ShipmentAllocation shipmentId-bağlı olduğundan reuse edilemez)
--   3) PrintedDocType'a yeni belge tipi (ayrı donmuş belge zinciri)
-- Hepsi backward-compatible: yeni-nullable kolonlar + yeni tablo + yeni enum değeri.
-- =============================================================================

-- 1) Yeni belge tipi (IF NOT EXISTS → idempotent; değer kullanılmadığı için tx-güvenli)
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'SUBCONTRACTOR_DIRECT_SHIP';

-- 2) SubcontractorDispatch doğrudan-sevk işareti
ALTER TABLE "subcontractor_dispatches"
  ADD COLUMN "directShippedAt"   TIMESTAMP(3),
  ADD COLUMN "directShippedById" UUID,
  ADD COLUMN "directShipReason"  TEXT;

ALTER TABLE "subcontractor_dispatches"
  ADD CONSTRAINT "subcontractor_dispatches_directShippedById_fkey"
  FOREIGN KEY ("directShippedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Opsiyonel karşılanma kaydı
CREATE TABLE "subcontractor_direct_ship_allocations" (
  "id"          UUID NOT NULL,
  "dispatchId"  UUID NOT NULL,
  "orderLineId" UUID NOT NULL,
  "qty"         DECIMAL(12,3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subcontractor_direct_ship_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subcontractor_direct_ship_allocations_dispatchId_orderLineId_key"
  ON "subcontractor_direct_ship_allocations"("dispatchId", "orderLineId");
CREATE INDEX "subcontractor_direct_ship_allocations_orderLineId_idx"
  ON "subcontractor_direct_ship_allocations"("orderLineId");

ALTER TABLE "subcontractor_direct_ship_allocations"
  ADD CONSTRAINT "subcontractor_direct_ship_allocations_dispatchId_fkey"
  FOREIGN KEY ("dispatchId") REFERENCES "subcontractor_dispatches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subcontractor_direct_ship_allocations"
  ADD CONSTRAINT "subcontractor_direct_ship_allocations_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
