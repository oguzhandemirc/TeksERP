-- =============================================================================
-- Migration: Refakat Kartı + Rota Şablonlama + Alokasyon + RollMovement + Manifest
-- =============================================================================
-- Kapsam:
--   3.1 Route/RouteStep iyileştirme (code, description, isFavorite, customerId, defaultNotes, CASCADE)
--   3.2 WorkOrderToOrderLine.allocatedQty (+ updatedAt drop)
--   3.3 WorkOrder.dyehouseCompanyId
--   3.4 RollMovement tablosu
--   3.5 Manifest tablosu
--   4.  TravelerCard + TravelerCardScan tabloları + enum'lar
--   R6  WorkOrderStep.skipReason
-- =============================================================================

-- CreateEnum
CREATE TYPE "TravelerCardStatus" AS ENUM ('ACTIVE', 'REPRINTED', 'VOIDED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('ARRIVAL', 'DEPARTURE', 'INFO');

-- =============================================================================
-- 3.1  routes + route_steps
-- =============================================================================

-- AlterTable (routes)
ALTER TABLE "routes"
  ADD COLUMN "code"        TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "isFavorite"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "customerId"  TEXT;

-- Unique + FK + indexes
CREATE UNIQUE INDEX "routes_code_key"        ON "routes"("code");
CREATE INDEX        "routes_customerId_idx"  ON "routes"("customerId");
CREATE INDEX        "routes_isFavorite_idx"  ON "routes"("isFavorite");

ALTER TABLE "routes"
  ADD CONSTRAINT "routes_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable (route_steps) — defaultNotes + CASCADE on routeId
ALTER TABLE "route_steps"
  ADD COLUMN "defaultNotes" TEXT;

ALTER TABLE "route_steps" DROP CONSTRAINT "route_steps_routeId_fkey";
ALTER TABLE "route_steps"
  ADD CONSTRAINT "route_steps_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "routes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 3.2  work_order_to_order_lines
-- =============================================================================

ALTER TABLE "work_order_to_order_lines"
  ADD COLUMN  "allocatedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  DROP COLUMN "updatedAt";

CREATE INDEX "work_order_to_order_lines_orderLineId_idx"
  ON "work_order_to_order_lines"("orderLineId");

-- =============================================================================
-- 3.3  work_orders — routeTemplateId + dyehouseCompanyId
-- =============================================================================

ALTER TABLE "work_orders"
  ADD COLUMN "routeTemplateId"   TEXT,
  ADD COLUMN "dyehouseCompanyId" TEXT;

CREATE INDEX "work_orders_routeTemplateId_idx"   ON "work_orders"("routeTemplateId");
CREATE INDEX "work_orders_dyehouseCompanyId_idx" ON "work_orders"("dyehouseCompanyId");

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_routeTemplateId_fkey"
  FOREIGN KEY ("routeTemplateId") REFERENCES "routes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_dyehouseCompanyId_fkey"
  FOREIGN KEY ("dyehouseCompanyId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- R6  work_order_steps.skipReason
-- =============================================================================

ALTER TABLE "work_order_steps"
  ADD COLUMN "skipReason" TEXT;

-- =============================================================================
-- 4.  TravelerCard
-- =============================================================================

CREATE TABLE "traveler_cards" (
  "id"          TEXT                 NOT NULL,
  "cardNumber"  TEXT                 NOT NULL,
  "barcode"     TEXT                 NOT NULL,
  "workOrderId" TEXT                 NOT NULL,
  "version"     INTEGER              NOT NULL DEFAULT 1,
  "status"      "TravelerCardStatus" NOT NULL DEFAULT 'ACTIVE',
  "printedAt"   TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "printedById" TEXT,
  "voidedAt"    TIMESTAMP(3),
  "voidReason"  TEXT,
  "createdAt"   TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)         NOT NULL,

  CONSTRAINT "traveler_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "traveler_cards_cardNumber_key" ON "traveler_cards"("cardNumber");
CREATE UNIQUE INDEX "traveler_cards_barcode_key"    ON "traveler_cards"("barcode");
CREATE INDEX        "traveler_cards_workOrderId_idx" ON "traveler_cards"("workOrderId");
CREATE INDEX        "traveler_cards_barcode_idx"    ON "traveler_cards"("barcode");
CREATE INDEX        "traveler_cards_status_idx"     ON "traveler_cards"("status");

-- Partial unique index: aynı WO için tek bir ACTIVE kart
CREATE UNIQUE INDEX "traveler_cards_workOrderId_active_key"
  ON "traveler_cards"("workOrderId")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "traveler_cards"
  ADD CONSTRAINT "traveler_cards_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "traveler_cards"
  ADD CONSTRAINT "traveler_cards_printedById_fkey"
  FOREIGN KEY ("printedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- 4.  TravelerCardScan
-- =============================================================================

CREATE TABLE "traveler_card_scans" (
  "id"              TEXT         NOT NULL,
  "cardId"          TEXT         NOT NULL,
  "stationId"       TEXT         NOT NULL,
  "workOrderStepId" TEXT,
  "scanType"        "ScanType"   NOT NULL,
  "scannedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scannedById"     TEXT,
  "deviceId"        TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "traveler_card_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "traveler_card_scans_cardId_idx"              ON "traveler_card_scans"("cardId");
CREATE INDEX "traveler_card_scans_stationId_scannedAt_idx" ON "traveler_card_scans"("stationId", "scannedAt");
CREATE INDEX "traveler_card_scans_workOrderStepId_idx"     ON "traveler_card_scans"("workOrderStepId");

ALTER TABLE "traveler_card_scans"
  ADD CONSTRAINT "traveler_card_scans_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "traveler_cards"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "traveler_card_scans"
  ADD CONSTRAINT "traveler_card_scans_stationId_fkey"
  FOREIGN KEY ("stationId") REFERENCES "stations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "traveler_card_scans"
  ADD CONSTRAINT "traveler_card_scans_workOrderStepId_fkey"
  FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "traveler_card_scans"
  ADD CONSTRAINT "traveler_card_scans_scannedById_fkey"
  FOREIGN KEY ("scannedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- 3.4  RollMovement
-- =============================================================================

CREATE TABLE "roll_movements" (
  "id"              TEXT             NOT NULL,
  "rollId"          TEXT             NOT NULL,
  "workOrderStepId" TEXT             NOT NULL,
  "qtyIn"           DOUBLE PRECISION NOT NULL,
  "qtyOut"          DOUBLE PRECISION,
  "weightIn"        DOUBLE PRECISION,
  "weightOut"       DOUBLE PRECISION,
  "enteredAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exitedAt"        TIMESTAMP(3),
  "operatorId"      TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "roll_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "roll_movements_rollId_idx"          ON "roll_movements"("rollId");
CREATE INDEX "roll_movements_workOrderStepId_idx" ON "roll_movements"("workOrderStepId");
CREATE INDEX "roll_movements_enteredAt_idx"       ON "roll_movements"("enteredAt");

ALTER TABLE "roll_movements"
  ADD CONSTRAINT "roll_movements_rollId_fkey"
  FOREIGN KEY ("rollId") REFERENCES "rolls"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roll_movements"
  ADD CONSTRAINT "roll_movements_workOrderStepId_fkey"
  FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roll_movements"
  ADD CONSTRAINT "roll_movements_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- 3.5  Manifest (Çeki Listesi kalıcı belge)
-- =============================================================================

CREATE TABLE "manifests" (
  "id"          TEXT         NOT NULL,
  "manifestNo"  TEXT         NOT NULL,
  "workOrderId" TEXT         NOT NULL,
  "printedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "printedById" TEXT,
  "snapshot"    JSONB        NOT NULL,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "manifests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manifests_manifestNo_key"  ON "manifests"("manifestNo");
CREATE INDEX        "manifests_workOrderId_idx" ON "manifests"("workOrderId");
CREATE INDEX        "manifests_manifestNo_idx"  ON "manifests"("manifestNo");

ALTER TABLE "manifests"
  ADD CONSTRAINT "manifests_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "manifests"
  ADD CONSTRAINT "manifests_printedById_fkey"
  FOREIGN KEY ("printedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
