-- =============================================================================
-- Station.kind + Roll step relations + RollError lifecycle + RollOperation log
-- =============================================================================

-- 1) StationKind enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StationKind') THEN
    CREATE TYPE "StationKind" AS ENUM (
      'RAW_QC',
      'PROCESS_QC',
      'TAMBUR',
      'SUBCONTRACTOR',
      'PACKAGING',
      'SHIPPING',
      'OTHER'
    );
  END IF;
END$$;

-- 2) RollOperationType enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RollOperationType') THEN
    CREATE TYPE "RollOperationType" AS ENUM (
      'KURSUN_APPLIED',
      'QC2_COMPLETED',
      'TAMBUR_PROCESSED',
      'PACKAGED',
      'SUBCONTRACTOR_SENT',
      'SUBCONTRACTOR_RETURNED'
    );
  END IF;
END$$;

-- 3) stations.kind
ALTER TABLE "stations"
  ADD COLUMN IF NOT EXISTS "kind" "StationKind" NOT NULL DEFAULT 'OTHER';

CREATE INDEX IF NOT EXISTS "stations_kind_idx" ON "stations"("kind");

-- 4) Roll step FK'leri — önceden plain TEXT idi, şimdi gerçek FK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rolls_currentStepId_fkey') THEN
    ALTER TABLE "rolls"
      ADD CONSTRAINT "rolls_currentStepId_fkey"
      FOREIGN KEY ("currentStepId") REFERENCES "work_order_steps"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rolls_producedInStepId_fkey') THEN
    ALTER TABLE "rolls"
      ADD CONSTRAINT "rolls_producedInStepId_fkey"
      FOREIGN KEY ("producedInStepId") REFERENCES "work_order_steps"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "rolls_currentStepId_idx"    ON "rolls"("currentStepId");
CREATE INDEX IF NOT EXISTS "rolls_producedInStepId_idx" ON "rolls"("producedInStepId");

-- 5) roll_errors lifecycle kolonları
ALTER TABLE "roll_errors"
  ADD COLUMN IF NOT EXISTS "detectedAtStepId"  TEXT,
  ADD COLUMN IF NOT EXISTS "detectedByUserId"  TEXT,
  ADD COLUMN IF NOT EXISTS "detectedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "processedAtStepId" TEXT,
  ADD COLUMN IF NOT EXISTS "processedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "processedAt"       TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_errors_detectedAtStepId_fkey') THEN
    ALTER TABLE "roll_errors"
      ADD CONSTRAINT "roll_errors_detectedAtStepId_fkey"
      FOREIGN KEY ("detectedAtStepId") REFERENCES "work_order_steps"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_errors_processedAtStepId_fkey') THEN
    ALTER TABLE "roll_errors"
      ADD CONSTRAINT "roll_errors_processedAtStepId_fkey"
      FOREIGN KEY ("processedAtStepId") REFERENCES "work_order_steps"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_errors_detectedByUserId_fkey') THEN
    ALTER TABLE "roll_errors"
      ADD CONSTRAINT "roll_errors_detectedByUserId_fkey"
      FOREIGN KEY ("detectedByUserId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_errors_processedByUserId_fkey') THEN
    ALTER TABLE "roll_errors"
      ADD CONSTRAINT "roll_errors_processedByUserId_fkey"
      FOREIGN KEY ("processedByUserId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "roll_errors_detectedAtStepId_idx"  ON "roll_errors"("detectedAtStepId");
CREATE INDEX IF NOT EXISTS "roll_errors_processedAtStepId_idx" ON "roll_errors"("processedAtStepId");
CREATE INDEX IF NOT EXISTS "roll_errors_isProcessed_idx"       ON "roll_errors"("isProcessed");

-- 6) roll_operations (yeni tablo)
CREATE TABLE IF NOT EXISTS "roll_operations" (
  "id"               TEXT PRIMARY KEY,
  "rollId"           TEXT NOT NULL,
  "workOrderStepId"  TEXT NOT NULL,
  "operationType"    "RollOperationType" NOT NULL,
  "operatorId"       TEXT,
  "metadata"         JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_operations_rollId_fkey') THEN
    ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_rollId_fkey"
      FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_operations_workOrderStepId_fkey') THEN
    ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_workOrderStepId_fkey"
      FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_operations_operatorId_fkey') THEN
    ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_operatorId_fkey"
      FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "roll_operations_rollId_workOrderStepId_operationType_key"
  ON "roll_operations"("rollId", "workOrderStepId", "operationType");
CREATE INDEX IF NOT EXISTS "roll_operations_rollId_idx"          ON "roll_operations"("rollId");
CREATE INDEX IF NOT EXISTS "roll_operations_workOrderStepId_idx" ON "roll_operations"("workOrderStepId");
CREATE INDEX IF NOT EXISTS "roll_operations_operationType_idx"   ON "roll_operations"("operationType");
