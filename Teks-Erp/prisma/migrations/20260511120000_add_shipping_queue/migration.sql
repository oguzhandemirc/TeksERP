-- =============================================================================
-- Shipping Queue: sipariş seviyesinde sevkiyat akışı
-- =============================================================================
-- Planlamacı bir siparişi sevkiyat akışına ekler; saha personeli kuyruktan
-- siparişi alır, depodan kumaşları kendisi tarar, çuvallara koyar ve sevkiyata
-- gönderir. Otomatik eşleştirme kaldırıldı.
-- =============================================================================

CREATE TYPE "ShippingQueueStatus" AS ENUM ('WAITING', 'TAKEN', 'DONE', 'CANCELLED');

CREATE TABLE "shipping_queue" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "isUrgent" BOOLEAN NOT NULL DEFAULT false,
  "urgentMarkedAt" TIMESTAMP(3),
  "status" "ShippingQueueStatus" NOT NULL DEFAULT 'WAITING',
  "assignedOperatorId" TEXT,
  "addedByUserId" TEXT NOT NULL,
  "note" TEXT,
  "takenAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shipping_queue_pkey" PRIMARY KEY ("id")
);

-- Bir sipariş aynı anda yalnız bir kez kuyrukta olabilir.
CREATE UNIQUE INDEX "shipping_queue_orderId_key" ON "shipping_queue"("orderId");

CREATE INDEX "shipping_queue_status_priority_createdAt_idx"
  ON "shipping_queue"("status", "priority", "createdAt");

CREATE INDEX "shipping_queue_status_isUrgent_urgentMarkedAt_priority_createdAt_idx"
  ON "shipping_queue"("status", "isUrgent", "urgentMarkedAt", "priority", "createdAt");

CREATE INDEX "shipping_queue_assignedOperatorId_idx"
  ON "shipping_queue"("assignedOperatorId");

ALTER TABLE "shipping_queue"
  ADD CONSTRAINT "shipping_queue_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shipping_queue"
  ADD CONSTRAINT "shipping_queue_addedByUserId_fkey"
  FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shipping_queue"
  ADD CONSTRAINT "shipping_queue_assignedOperatorId_fkey"
  FOREIGN KEY ("assignedOperatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
