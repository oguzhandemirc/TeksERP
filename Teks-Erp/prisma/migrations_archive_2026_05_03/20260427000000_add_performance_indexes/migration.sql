-- Performance indexes added 2026-04-27
-- Drop redundant index (barcode @unique already provides B-tree index)
DROP INDEX "rolls_barcode_idx";

-- Tambur ekranı: bir topun bekleyen hatalarını listele
CREATE INDEX "roll_errors_rollId_isProcessed_idx" ON "roll_errors"("rollId", "isProcessed");

-- Liste sayfaları: status filter + createdAt desc sort
CREATE INDEX "rolls_status_createdAt_idx" ON "rolls"("status", "createdAt");

-- Audit tablosu en hızlı büyüyen tablodur — zaman aralığı sorguları için
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt");

-- Production/packaging/shipping/subcontractor servislerinde 8 yerde kullanılan paterne karşılık
CREATE INDEX "work_order_steps_workOrderId_status_idx" ON "work_order_steps"("workOrderId", "status");
