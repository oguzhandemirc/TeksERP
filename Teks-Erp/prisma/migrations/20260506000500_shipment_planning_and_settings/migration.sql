-- =============================================================================
-- Sevkiyat planlama + manuel kapatma + tolerans ayarı
-- =============================================================================
-- 1. Order: completedAt + manualClose alanları (otomatik vs manuel kapatma izi)
-- 2. Shipment: priority + plannedDate (planlamacı sırası ve hedef tarih)
-- 3. ShipmentPlannedOrder: sevkiyat-sipariş planlama ilişkisi
-- 4. SystemSetting: tolerance ve diğer runtime config'ler
-- =============================================================================

-- 1) Order tarafı
ALTER TABLE "orders"
  ADD COLUMN "completedAt"        TIMESTAMP(3),
  ADD COLUMN "manualClosedById"   TEXT,
  ADD COLUMN "manualCloseReason"  TEXT;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_manualClosedById_fkey"
  FOREIGN KEY ("manualClosedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_manualClosedById_idx" ON "orders"("manualClosedById");

-- 2) Shipment tarafı
ALTER TABLE "shipments"
  ADD COLUMN "priority"     INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN "plannedDate"  TIMESTAMP(3);

CREATE INDEX "shipments_status_priority_plannedDate_idx"
  ON "shipments"("status", "priority", "plannedDate");

-- 3) Sevkiyat planı: hangi siparişler bu sevkiyatta planlandı (m:n)
CREATE TABLE "shipment_planned_orders" (
    "id"            TEXT         NOT NULL,
    "shipmentId"    TEXT         NOT NULL,
    "orderId"       TEXT         NOT NULL,
    "sortOrder"     INTEGER      NOT NULL DEFAULT 0,
    "note"          TEXT,
    "addedByUserId" TEXT         NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_planned_orders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "shipment_planned_orders"
  ADD CONSTRAINT "shipment_planned_orders_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipment_planned_orders"
  ADD CONSTRAINT "shipment_planned_orders_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipment_planned_orders"
  ADD CONSTRAINT "shipment_planned_orders_addedByUserId_fkey"
  FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "shipment_planned_orders_shipmentId_orderId_key"
  ON "shipment_planned_orders"("shipmentId", "orderId");

CREATE INDEX "shipment_planned_orders_shipmentId_idx"
  ON "shipment_planned_orders"("shipmentId");

CREATE INDEX "shipment_planned_orders_orderId_idx"
  ON "shipment_planned_orders"("orderId");

-- 4) Runtime ayarları (key-value)
CREATE TABLE "system_settings" (
    "key"         TEXT         NOT NULL,
    "value"       TEXT         NOT NULL,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "system_settings"
  ADD CONSTRAINT "system_settings_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) Tolerance default değerini seed et
INSERT INTO "system_settings" ("key", "value", "description", "updatedAt")
VALUES (
  'shipping.toleranceMeters',
  '5',
  'Sevk metrajı talebin altında kalsa bile siparişin otomatik COMPLETED kapanması için kabul edilen fire payı (metre).',
  CURRENT_TIMESTAMP
);
