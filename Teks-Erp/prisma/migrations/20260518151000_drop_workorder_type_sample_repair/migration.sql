-- WorkOrderType enum'undan SAMPLE_PRODUCTION ve REPAIR_REWORK kaldırılır.
-- Postgres enum değerleri tek tek drop edilemez → yeni enum üret, kolonları taşı,
-- eski enum'u düşür.

-- 1) Mevcut satırları güvenli karşılıklarına çevir (test verisi).
UPDATE "work_orders"
SET "type" = 'STOCK_PRODUCTION'
WHERE "type" IN ('SAMPLE_PRODUCTION', 'REPAIR_REWORK');

-- 2) Eski tipi yeniden adlandır, yeni tipi oluştur.
ALTER TYPE "WorkOrderType" RENAME TO "WorkOrderType_old";

CREATE TYPE "WorkOrderType" AS ENUM (
  'ORDER_PRODUCTION',
  'STOCK_PRODUCTION',
  'SERVICE_PRODUCTION'
);

-- 3) Kolonu yeni tipe taşı (default'u önce drop, sonra tekrar set).
ALTER TABLE "work_orders" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "work_orders"
  ALTER COLUMN "type" TYPE "WorkOrderType"
  USING ("type"::text::"WorkOrderType");
ALTER TABLE "work_orders" ALTER COLUMN "type" SET DEFAULT 'ORDER_PRODUCTION';

-- 4) Eski tipi düşür.
DROP TYPE "WorkOrderType_old";
