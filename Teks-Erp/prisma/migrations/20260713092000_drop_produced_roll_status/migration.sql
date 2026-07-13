-- Faz 6: RollStatus enum'undan PRODUCED değeri KALDIRILIR. "Her rota son adımı finalize
-- eder → WAREHOUSE" modelinde PRODUCED limbosu artık hiç yazılmıyor. Enum-değeri silme
-- Postgres'te rename-type deseniyle yapılır (20260712130000_drop_at_door emsali). Boş
-- DB'de aşağıdaki UPDATE'ler savunma amaçlı (4 RollStatus kolonu).

UPDATE "rolls"          SET "status"             = 'WAREHOUSE' WHERE "status"::text             = 'PRODUCED';
UPDATE "quality_grades" SET "targetStatus"       = 'WAREHOUSE' WHERE "targetStatus"::text       = 'PRODUCED';
UPDATE "quality_grades" SET "returnTargetStatus" = 'WAREHOUSE' WHERE "returnTargetStatus"::text = 'PRODUCED';
UPDATE "roll_returns"   SET "appliedStatus"      = 'WAREHOUSE' WHERE "appliedStatus"::text      = 'PRODUCED';

ALTER TYPE "RollStatus" RENAME TO "RollStatus_old";
CREATE TYPE "RollStatus" AS ENUM (
  'STOCK','IN_PRODUCTION','SCRAP','CANCELLED','AT_SUBCONTRACTOR','A1_STOCK',
  'RETURNED_FROM_SUBCONTRACTOR','WAREHOUSE','SHIPPED','TAMBUR_CONSUMED',
  'SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED'
);

ALTER TABLE "rolls" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "rolls" ALTER COLUMN "status" TYPE "RollStatus" USING ("status"::text::"RollStatus");
ALTER TABLE "rolls" ALTER COLUMN "status" SET DEFAULT 'STOCK';

ALTER TABLE "quality_grades" ALTER COLUMN "targetStatus" DROP DEFAULT;
ALTER TABLE "quality_grades" ALTER COLUMN "targetStatus" TYPE "RollStatus" USING ("targetStatus"::text::"RollStatus");
ALTER TABLE "quality_grades" ALTER COLUMN "targetStatus" SET DEFAULT 'SCRAP';
ALTER TABLE "quality_grades" ALTER COLUMN "returnTargetStatus" TYPE "RollStatus" USING ("returnTargetStatus"::text::"RollStatus");

ALTER TABLE "roll_returns" ALTER COLUMN "appliedStatus" TYPE "RollStatus" USING ("appliedStatus"::text::"RollStatus");

DROP TYPE "RollStatus_old";
