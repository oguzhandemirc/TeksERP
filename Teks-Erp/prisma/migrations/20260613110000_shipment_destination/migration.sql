-- Saha #19+#22: yurtiçi/yurtdışı sevkiyat ayrımı
-- CreateEnum
CREATE TYPE "ShipmentDestination" AS ENUM ('DOMESTIC', 'EXPORT');

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "destination" "ShipmentDestination" NOT NULL DEFAULT 'DOMESTIC';
