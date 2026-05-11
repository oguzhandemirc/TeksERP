-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "width" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "width" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "plannedEndDate" TIMESTAMP(3),
ADD COLUMN     "plannedStartDate" TIMESTAMP(3);
