-- =============================================================================
-- Subcontractor (Fason) + Swatch (Kartela) + Roll genişletmeleri
-- =============================================================================

-- 1) Yeni RollStatus enum değerleri
ALTER TYPE "RollStatus" ADD VALUE IF NOT EXISTS 'AT_SUBCONTRACTOR';
ALTER TYPE "RollStatus" ADD VALUE IF NOT EXISTS 'A1_STOCK';
ALTER TYPE "RollStatus" ADD VALUE IF NOT EXISTS 'RETURNED_FROM_SUBCONTRACTOR';

-- 2) Roll.parentRollId (self-ref) — fason dönüşü / tambur kesim izi
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "parentRollId" TEXT;

-- parentRollId FK (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rolls_parentRollId_fkey'
  ) THEN
    ALTER TABLE "rolls"
      ADD CONSTRAINT "rolls_parentRollId_fkey"
      FOREIGN KEY ("parentRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "rolls_parentRollId_idx" ON "rolls"("parentRollId");

-- =============================================================================
-- 3) subcontractor_dispatches
-- =============================================================================
CREATE TABLE IF NOT EXISTS "subcontractor_dispatches" (
  "id"              TEXT PRIMARY KEY,
  "dispatchNo"      TEXT NOT NULL UNIQUE,
  "workOrderId"     TEXT NOT NULL,
  "stepId"          TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "plateNumber"     TEXT,
  "driverName"      TEXT,
  "dispatchedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedById"  TEXT,
  "notes"           TEXT,
  "totalQty"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_dispatches_workOrderId_fkey') THEN
    ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_dispatches_stepId_fkey') THEN
    ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_stepId_fkey"
      FOREIGN KEY ("stepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_dispatches_companyId_fkey') THEN
    ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_dispatches_dispatchedById_fkey') THEN
    ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_dispatchedById_fkey"
      FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "subcontractor_dispatches_workOrderId_idx" ON "subcontractor_dispatches"("workOrderId");
CREATE INDEX IF NOT EXISTS "subcontractor_dispatches_stepId_idx"      ON "subcontractor_dispatches"("stepId");
CREATE INDEX IF NOT EXISTS "subcontractor_dispatches_companyId_idx"   ON "subcontractor_dispatches"("companyId");

-- =============================================================================
-- 4) subcontractor_dispatch_items
-- =============================================================================
CREATE TABLE IF NOT EXISTS "subcontractor_dispatch_items" (
  "id"              TEXT PRIMARY KEY,
  "dispatchId"      TEXT NOT NULL,
  "rollId"          TEXT NOT NULL,
  "dispatchedQty"   DOUBLE PRECISION NOT NULL,
  "dispatchedWeight" DOUBLE PRECISION,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_dispatch_items_dispatchId_fkey') THEN
    ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_dispatchId_fkey"
      FOREIGN KEY ("dispatchId") REFERENCES "subcontractor_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_dispatch_items_rollId_fkey') THEN
    ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_rollId_fkey"
      FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "subcontractor_dispatch_items_dispatchId_idx" ON "subcontractor_dispatch_items"("dispatchId");
CREATE INDEX IF NOT EXISTS "subcontractor_dispatch_items_rollId_idx"     ON "subcontractor_dispatch_items"("rollId");

-- =============================================================================
-- 5) subcontractor_receipts
-- =============================================================================
CREATE TABLE IF NOT EXISTS "subcontractor_receipts" (
  "id"              TEXT PRIMARY KEY,
  "receiptNo"       TEXT NOT NULL UNIQUE,
  "manifestNo"      TEXT NOT NULL,
  "workOrderId"     TEXT NOT NULL,
  "stepId"          TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedById"    TEXT,
  "notes"           TEXT,
  "totalIncomingQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "firingMeters"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipts_workOrderId_fkey') THEN
    ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipts_stepId_fkey') THEN
    ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_stepId_fkey"
      FOREIGN KEY ("stepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipts_companyId_fkey') THEN
    ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipts_receivedById_fkey') THEN
    ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_receivedById_fkey"
      FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "subcontractor_receipts_workOrderId_idx" ON "subcontractor_receipts"("workOrderId");
CREATE INDEX IF NOT EXISTS "subcontractor_receipts_stepId_idx"      ON "subcontractor_receipts"("stepId");
CREATE INDEX IF NOT EXISTS "subcontractor_receipts_companyId_idx"   ON "subcontractor_receipts"("companyId");
CREATE INDEX IF NOT EXISTS "subcontractor_receipts_manifestNo_idx"  ON "subcontractor_receipts"("manifestNo");

-- =============================================================================
-- 6) subcontractor_receipt_items
-- =============================================================================
CREATE TABLE IF NOT EXISTS "subcontractor_receipt_items" (
  "id"                    TEXT PRIMARY KEY,
  "receiptId"             TEXT NOT NULL,
  "newRollId"             TEXT NOT NULL UNIQUE,
  "sourceDispatchItemId"  TEXT,
  "incomingQty"           DOUBLE PRECISION NOT NULL,
  "incomingWeight"        DOUBLE PRECISION,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipt_items_receiptId_fkey') THEN
    ALTER TABLE "subcontractor_receipt_items" ADD CONSTRAINT "subcontractor_receipt_items_receiptId_fkey"
      FOREIGN KEY ("receiptId") REFERENCES "subcontractor_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipt_items_newRollId_fkey') THEN
    ALTER TABLE "subcontractor_receipt_items" ADD CONSTRAINT "subcontractor_receipt_items_newRollId_fkey"
      FOREIGN KEY ("newRollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcontractor_receipt_items_sourceDispatchItemId_fkey') THEN
    ALTER TABLE "subcontractor_receipt_items" ADD CONSTRAINT "subcontractor_receipt_items_sourceDispatchItemId_fkey"
      FOREIGN KEY ("sourceDispatchItemId") REFERENCES "subcontractor_dispatch_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "subcontractor_receipt_items_receiptId_idx"            ON "subcontractor_receipt_items"("receiptId");
CREATE INDEX IF NOT EXISTS "subcontractor_receipt_items_newRollId_idx"            ON "subcontractor_receipt_items"("newRollId");
CREATE INDEX IF NOT EXISTS "subcontractor_receipt_items_sourceDispatchItemId_idx" ON "subcontractor_receipt_items"("sourceDispatchItemId");

-- =============================================================================
-- 7) swatches (Kartela)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "swatches" (
  "id"           TEXT PRIMARY KEY,
  "cardNumber"   TEXT NOT NULL UNIQUE,
  "barcode"      TEXT NOT NULL UNIQUE,
  "itemId"       TEXT NOT NULL,
  "variantId"    TEXT,
  "width"        DOUBLE PRECISION,
  "length"       DOUBLE PRECISION NOT NULL,
  "workOrderId"  TEXT,
  "parentRollId" TEXT,
  "purpose"      TEXT,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swatches_itemId_fkey') THEN
    ALTER TABLE "swatches" ADD CONSTRAINT "swatches_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swatches_variantId_fkey') THEN
    ALTER TABLE "swatches" ADD CONSTRAINT "swatches_variantId_fkey"
      FOREIGN KEY ("variantId") REFERENCES "item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swatches_workOrderId_fkey') THEN
    ALTER TABLE "swatches" ADD CONSTRAINT "swatches_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swatches_parentRollId_fkey') THEN
    ALTER TABLE "swatches" ADD CONSTRAINT "swatches_parentRollId_fkey"
      FOREIGN KEY ("parentRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swatches_createdById_fkey') THEN
    ALTER TABLE "swatches" ADD CONSTRAINT "swatches_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "swatches_itemId_idx"       ON "swatches"("itemId");
CREATE INDEX IF NOT EXISTS "swatches_workOrderId_idx"  ON "swatches"("workOrderId");
CREATE INDEX IF NOT EXISTS "swatches_parentRollId_idx" ON "swatches"("parentRollId");
CREATE INDEX IF NOT EXISTS "swatches_barcode_idx"      ON "swatches"("barcode");
