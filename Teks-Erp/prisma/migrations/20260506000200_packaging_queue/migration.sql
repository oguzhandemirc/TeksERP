-- =============================================================================
-- Phase 3: Packaging Queue
-- =============================================================================
-- Planlamacı odaklı paketleme kuyruğu. Operatör artık sipariş seçmez —
-- kuyruktan sıradakini alır. Aynı sipariş için aktif (WAITING/TAKEN) tek
-- kayıt olabilir; DONE/CANCELLED tarihçe olarak tutulur.
-- =============================================================================

-- Status enum
CREATE TYPE "PackagingQueueStatus" AS ENUM ('WAITING', 'TAKEN', 'DONE', 'CANCELLED');

-- Tablo
CREATE TABLE "packaging_queue" (
    "id"                  TEXT                   NOT NULL,
    "orderId"             TEXT                   NOT NULL,
    "priority"            INTEGER                NOT NULL DEFAULT 0,
    "status"              "PackagingQueueStatus" NOT NULL DEFAULT 'WAITING',
    "assignedOperatorId"  TEXT,
    "addedByUserId"       TEXT                   NOT NULL,
    "note"                TEXT,
    "takenAt"             TIMESTAMP(3),
    "completedAt"         TIMESTAMP(3),
    "cancelledAt"         TIMESTAMP(3),
    "cancelReason"        TEXT,
    "createdAt"           TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3)           NOT NULL,

    CONSTRAINT "packaging_queue_pkey" PRIMARY KEY ("id")
);

-- FK'ler
ALTER TABLE "packaging_queue"
  ADD CONSTRAINT "packaging_queue_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "packaging_queue"
  ADD CONSTRAINT "packaging_queue_addedByUserId_fkey"
  FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "packaging_queue"
  ADD CONSTRAINT "packaging_queue_assignedOperatorId_fkey"
  FOREIGN KEY ("assignedOperatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Standart index'ler (FK + sorgu desenleri)
CREATE INDEX "packaging_queue_status_priority_createdAt_idx"
  ON "packaging_queue"("status", "priority", "createdAt");

CREATE INDEX "packaging_queue_orderId_idx"
  ON "packaging_queue"("orderId");

CREATE INDEX "packaging_queue_assignedOperatorId_idx"
  ON "packaging_queue"("assignedOperatorId");

-- Aktif kayıtlarda orderId benzersiz: aynı siparişin aynı anda hem WAITING hem
-- TAKEN olması engellenir. DONE/CANCELLED kayıtları tarihçedir, kısıtlanmaz.
CREATE UNIQUE INDEX "packaging_queue_active_order_uq"
  ON "packaging_queue"("orderId")
  WHERE "status" IN ('WAITING', 'TAKEN');
