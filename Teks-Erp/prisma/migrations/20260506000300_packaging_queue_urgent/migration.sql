-- =============================================================================
-- Phase 3.1: PackagingQueue.isUrgent
-- =============================================================================
-- Acil sipariş senaryosu: planlamacı kuyruktaki bir kaydı "acil" olarak
-- işaretleyebilir. Acil kayıtlar listede tepeye taşınır; aralarında
-- urgentMarkedAt FIFO sırası uygulanır (ilk acil işaretlenen daha üstte).
-- =============================================================================

ALTER TABLE "packaging_queue"
  ADD COLUMN "isUrgent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "packaging_queue"
  ADD COLUMN "urgentMarkedAt" TIMESTAMP(3);

-- Sıralama index'i: status filtresi + acil DESC + acil FIFO + normal sıralama
CREATE INDEX "packaging_queue_status_isUrgent_urgentMarkedAt_priority_idx"
  ON "packaging_queue"("status", "isUrgent", "urgentMarkedAt", "priority", "createdAt");
