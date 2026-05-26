-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('TRY', 'USD', 'EUR', 'GBP');

-- AlterTable
ALTER TABLE "colors" ALTER COLUMN "hex" SET DATA TYPE VARCHAR(7);

-- AlterTable
ALTER TABLE "fabric_properties" ALTER COLUMN "color" SET DATA TYPE VARCHAR(7);

-- AlterTable
ALTER TABLE "quality_grades" ALTER COLUMN "color" SET DATA TYPE VARCHAR(7);

-- AlterTable
ALTER TABLE "rolls" ALTER COLUMN "qualityGrade" DROP DEFAULT;

-- AlterTable: orders.currency String → Currency enum
-- Mevcut değerler hep 'TRY' (TS validation + default), USING ile cast güvenli.
ALTER TABLE "orders"
  ALTER COLUMN "currency" DROP DEFAULT,
  ALTER COLUMN "currency" TYPE "Currency" USING ("currency"::"Currency"),
  ALTER COLUMN "currency" SET DEFAULT 'TRY';
