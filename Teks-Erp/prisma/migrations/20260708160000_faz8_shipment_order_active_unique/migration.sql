-- Faz 8 — F103: "bir sipariş aynı anda en fazla BİR aktif sevkiyatta" DB seddi.
-- Backend'in createShipment'teki geçici serileştirme kilidinin (order.updateMany) yerini
-- alır: race yerine DB partial-unique reddeder. "active" = shipment.status IN
-- (PREPARING, READY, AT_DOOR). isActive DENORM bayrağı — bakımı UYGULAMA katmanında
-- (dispatch/cancel -> false, reopen/uncancel -> true). Partial unique, roll_movements_
-- one_open_per_roll_step_uq emsali gibi RAW-SQL (şemada @@index karşılığı bilinçli YOK).
-- Pre-flight: aktif sevkiyatta çift sipariş = 0 (constraint güvenli).
SET statement_timeout = 0;

ALTER TABLE "shipment_orders" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: finalize olmuş (DISPATCHED/CANCELLED) sevkiyatların pivot satırları PASİF.
UPDATE "shipment_orders" so SET "isActive" = false
  FROM "shipments" s
  WHERE s."id" = so."shipmentId" AND s."status" IN ('DISPATCHED', 'CANCELLED');

-- İnvariant seddi.
CREATE UNIQUE INDEX "shipment_orders_active_order_uq" ON "shipment_orders" ("orderId") WHERE "isActive";
