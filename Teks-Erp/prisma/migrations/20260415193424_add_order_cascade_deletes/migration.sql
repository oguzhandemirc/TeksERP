-- DropForeignKey
ALTER TABLE "order_allocations" DROP CONSTRAINT "order_allocations_orderLineId_fkey";

-- DropForeignKey
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_orderId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_to_order_lines" DROP CONSTRAINT "work_order_to_order_lines_orderLineId_fkey";

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_to_order_lines" ADD CONSTRAINT "work_order_to_order_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
