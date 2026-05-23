-- Order.shippedQty: denormalize sevk toplamı (m)
-- Tek yazma noktası: recomputeOrderStatus helper.

ALTER TABLE "orders" ADD COLUMN "shippedQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: mevcut siparişler için shipment_items üzerinden topla.
-- Sadece SHIPPED statüdeki sevkiyatlar sayılır (recomputeOrderStatus ile aynı kontrat).
UPDATE "orders" o
SET "shippedQty" = COALESCE(s.total, 0)
FROM (
  SELECT ol."orderId" AS order_id, SUM(si."shippedQty") AS total
  FROM "order_lines" ol
  JOIN "order_allocations" oa ON oa."orderLineId" = ol."id"
  JOIN "shipment_items" si ON si."rollId" = oa."rollId"
  JOIN "shipments" sh ON sh."id" = si."shipmentId"
  WHERE sh."status" = 'SHIPPED'
  GROUP BY ol."orderId"
) s
WHERE o."id" = s.order_id;
