-- =============================================================================
-- DEVERE EK B2 — LEVENT GÖVDESİ: boş sevk bağı + sahibine iade belgesi (2026-11-20)
-- =============================================================================
-- Yalnız EKLEME: `beam_body_events`e boş-kolon `subcontractorDispatchId` (NULL doğar, eski satırlar dokunulmaz),
-- iki yeni tablo (iade belgesi + kalemi) ve CHECK'ler. Geri alınabilir (tablolar boş doğar).
-- =============================================================================

-- AlterTable
ALTER TABLE "beam_body_events" ADD COLUMN     "subcontractorDispatchId" UUID;

-- CreateTable
CREATE TABLE "beam_body_returns" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(64) NOT NULL,
    "clientToken" UUID,
    "ownerCustomerId" UUID NOT NULL,
    "returnedAt" TIMESTAMPTZ NOT NULL,
    "plateNumber" VARCHAR(32),
    "driverName" VARCHAR(100),
    "notes" VARCHAR(500),
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "beam_body_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beam_body_return_items" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "bodyId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beam_body_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "beam_body_returns_docNo_key" ON "beam_body_returns"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "beam_body_returns_clientToken_key" ON "beam_body_returns"("clientToken");

-- CreateIndex
CREATE INDEX "beam_body_returns_ownerCustomerId_returnedAt_idx" ON "beam_body_returns"("ownerCustomerId", "returnedAt");

-- CreateIndex
CREATE INDEX "beam_body_returns_returnedAt_idx" ON "beam_body_returns"("returnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "beam_body_return_items_eventId_key" ON "beam_body_return_items"("eventId");

-- CreateIndex
CREATE INDEX "beam_body_return_items_bodyId_idx" ON "beam_body_return_items"("bodyId");

-- CreateIndex
CREATE UNIQUE INDEX "beam_body_return_items_returnId_bodyId_key" ON "beam_body_return_items"("returnId", "bodyId");

-- CreateIndex
CREATE INDEX "beam_body_events_subcontractorDispatchId_idx" ON "beam_body_events"("subcontractorDispatchId");

-- AddForeignKey
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_subcontractorDispatchId_fkey" FOREIGN KEY ("subcontractorDispatchId") REFERENCES "subcontractor_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_returns" ADD CONSTRAINT "beam_body_returns_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_return_items" ADD CONSTRAINT "beam_body_return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "beam_body_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_return_items" ADD CONSTRAINT "beam_body_return_items_bodyId_fkey" FOREIGN KEY ("bodyId") REFERENCES "beam_bodies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_body_return_items" ADD CONSTRAINT "beam_body_return_items_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "beam_body_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sevk bağı yalnız boş gidiş olayında (iplik sevkiyle giden gövde); ters olay bağı taşımaz.
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_dispatch_ck"
  CHECK ("subcontractorDispatchId" IS NULL OR "kind" = 'SHIP_EMPTY');

-- İade belgesi iptali üçlüsü birlikte dolar (zaman · yapan · sebep).
ALTER TABLE "beam_body_returns" ADD CONSTRAINT "beam_body_returns_cancel_ck"
  CHECK ((("cancelledAt" IS NULL) = ("cancelledById" IS NULL)) AND (("cancelledAt" IS NULL) = ("cancelReason" IS NULL)));
