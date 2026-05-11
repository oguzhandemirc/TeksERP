-- =============================================================================
-- Schema sync: enum updates + missing tables
-- =============================================================================
-- Bu içerik şemada vardı ama hiçbir migration tarafından kayıt altına alınmamıştı
-- (mevcut dev DB'lere manuel olarak yamanmıştı). Clean reset için tek migration'a
-- toplandı.
-- =============================================================================

-- ENUM: WorkOrderType — eski değerler yeni schema isimleriyle değiştiriliyor
ALTER TABLE "work_orders" ALTER COLUMN "type" DROP DEFAULT;
ALTER TYPE "WorkOrderType" RENAME VALUE 'WEAVING' TO 'STOCK_PRODUCTION';
ALTER TYPE "WorkOrderType" RENAME VALUE 'WARPING' TO 'SAMPLE_PRODUCTION';
ALTER TYPE "WorkOrderType" RENAME VALUE 'FABRIC_DYEING' TO 'ORDER_PRODUCTION';
ALTER TYPE "WorkOrderType" RENAME VALUE 'RE_PROCESS' TO 'REPAIR_REWORK';
ALTER TABLE "work_orders" ALTER COLUMN "type" SET DEFAULT 'ORDER_PRODUCTION';

-- ENUM: RollStatus — paketleme sonrası depo durumu
ALTER TYPE "RollStatus" ADD VALUE IF NOT EXISTS 'WAREHOUSE';

-- COLUMN drift: rolls.design eski, kaldırılıyor
ALTER TABLE "rolls" DROP COLUMN IF EXISTS "design";

-- COLUMN drift: work_orders.targetQuantity ekleniyor
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "targetQuantity" DOUBLE PRECISION;

-- DEFECT_TYPES — hata tipi kataloğu
CREATE TABLE IF NOT EXISTS "defect_types" (
    "id"          TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "severity"    TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "defect_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "defect_types_code_key" ON "defect_types"("code");
CREATE INDEX IF NOT EXISTS "defect_types_isActive_idx" ON "defect_types"("isActive");

-- ROLL_ERRORS.defectTypeId — DefectType FK
ALTER TABLE "roll_errors" ADD COLUMN IF NOT EXISTS "defectTypeId" TEXT;
CREATE INDEX IF NOT EXISTS "roll_errors_defectTypeId_idx" ON "roll_errors"("defectTypeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_errors_defectTypeId_fkey') THEN
    ALTER TABLE "roll_errors"
      ADD CONSTRAINT "roll_errors_defectTypeId_fkey"
      FOREIGN KEY ("defectTypeId") REFERENCES "defect_types"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- QUALITY_GRADES — kalite derecesi kataloğu
CREATE TABLE IF NOT EXISTS "quality_grades" (
    "id"          TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "color"       TEXT,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quality_grades_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quality_grades_code_key" ON "quality_grades"("code");
CREATE INDEX IF NOT EXISTS "quality_grades_isActive_sortOrder_idx" ON "quality_grades"("isActive", "sortOrder");

-- SYSTEM_LOG_ARCHIVES — periyodik arşiv tablosu
CREATE TABLE IF NOT EXISTS "system_log_archives" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT,
    "action"     TEXT NOT NULL,
    "tableName"  TEXT NOT NULL,
    "recordId"   TEXT NOT NULL,
    "oldData"    JSONB,
    "newData"    JSONB,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"  TIMESTAMP(3) NOT NULL,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_log_archives_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "system_log_archives_tableName_recordId_idx" ON "system_log_archives"("tableName", "recordId");
CREATE INDEX IF NOT EXISTS "system_log_archives_createdAt_idx" ON "system_log_archives"("createdAt");
