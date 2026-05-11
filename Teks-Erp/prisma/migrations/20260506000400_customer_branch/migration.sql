-- =============================================================================
-- CustomerBranch + Shipment.branchId
-- =============================================================================
-- Sevkiyatın hedefi: müşterinin bir şubesi (Ankara şubesi, merkez depo, vs.).
-- Eski sevkiyatlar branch'siz kalır (NULL); yeni planlamada zorunlu hale
-- getirilebilir (uygulama kuralı).
-- =============================================================================

CREATE TABLE "customer_branches" (
    "id"           TEXT         NOT NULL,
    "customerId"   TEXT         NOT NULL,
    "code"         TEXT,
    "name"         TEXT         NOT NULL,
    "address"      TEXT,
    "city"         TEXT,
    "district"     TEXT,
    "contactName"  TEXT,
    "contactPhone" TEXT,
    "notes"        TEXT,
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_branches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer_branches"
  ADD CONSTRAINT "customer_branches_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "customer_branches_customerId_idx"
  ON "customer_branches"("customerId");

CREATE INDEX "customer_branches_customerId_isActive_idx"
  ON "customer_branches"("customerId", "isActive");

-- Shipment'a branch alanı (opsiyonel — eski kayıtlar null kalır)
ALTER TABLE "shipments"
  ADD COLUMN "branchId"             TEXT,
  ADD COLUMN "branchNameSnapshot"   TEXT;

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "shipments_branchId_idx" ON "shipments"("branchId");
