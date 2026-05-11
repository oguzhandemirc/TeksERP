-- =============================================================================
-- Phase 2: ReproductionBacklog tablosu
-- =============================================================================
-- Bir allocation başka siparişe taşındığında (reassignAllocation) kaynak
-- OrderLine için bir "borç" kaydı oluşur. Yeni allocation/üretim ile kapanır.
-- =============================================================================

CREATE TABLE "reproduction_backlog" (
  "id"           TEXT        NOT NULL,
  "orderLineId"  TEXT        NOT NULL,
  "qtyDeficit"   DOUBLE PRECISION NOT NULL,
  "reason"       TEXT        NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"   TIMESTAMP(3),
  "resolvedNote" TEXT,

  CONSTRAINT "reproduction_backlog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reproduction_backlog_orderLineId_resolvedAt_idx"
  ON "reproduction_backlog" ("orderLineId", "resolvedAt");

CREATE INDEX "reproduction_backlog_resolvedAt_idx"
  ON "reproduction_backlog" ("resolvedAt");

ALTER TABLE "reproduction_backlog"
  ADD CONSTRAINT "reproduction_backlog_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
