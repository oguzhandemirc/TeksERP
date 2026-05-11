-- =============================================================================
-- Remove target color/properties from OrderLine + WorkOrder (Final Item refactor)
-- =============================================================================
-- Final Item (PATOS-MAVI-YANMAZ gibi) artık ham ürün üzerinden tanımlar
-- ekranında manuel oluşturulur; sipariş ve iş emri direkt final Item'a işaret
-- eder. Önceki "ayrıca renk + özellikler tut" alanları kaldırıldı.
-- =============================================================================

-- DropForeignKey
ALTER TABLE "order_line_target_properties" DROP CONSTRAINT "order_line_target_properties_orderLineId_fkey";
ALTER TABLE "order_line_target_properties" DROP CONSTRAINT "order_line_target_properties_propertyId_fkey";
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_targetColorId_fkey";
ALTER TABLE "work_order_target_properties" DROP CONSTRAINT "work_order_target_properties_plannedStepId_fkey";
ALTER TABLE "work_order_target_properties" DROP CONSTRAINT "work_order_target_properties_propertyId_fkey";
ALTER TABLE "work_order_target_properties" DROP CONSTRAINT "work_order_target_properties_workOrderId_fkey";
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_targetColorId_fkey";
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_targetColorStepId_fkey";

-- DropIndex
DROP INDEX "order_lines_targetColorId_idx";
DROP INDEX "work_orders_targetColorId_idx";
DROP INDEX "work_orders_targetColorStepId_idx";

-- AlterTable
ALTER TABLE "order_lines" DROP COLUMN "targetColorId";
ALTER TABLE "work_orders" DROP COLUMN "targetColorId",
                          DROP COLUMN "targetColorStepId";

-- DropTable
DROP TABLE "order_line_target_properties";
DROP TABLE "work_order_target_properties";
