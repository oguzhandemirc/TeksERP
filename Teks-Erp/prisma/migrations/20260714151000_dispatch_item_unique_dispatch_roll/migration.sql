-- Derinlemesine savunma: dispatch kalemlerinde (dispatchId, rollId) unique —
-- aynı top aynı fason/kartela sevkine iki satır olarak yazılamaz. Koruma bugüne
-- dek yalnız uygulama katmanındaki atomik claim'deydi (subcontractor.service
-- tx-içi updateMany + count); kardeş tablolarda (SubcontractorReceiptItem,
-- KartelaReceiptItem, SackAllocation) DB seddi zaten vardı — simetri kapatıldı.
-- Ön koşul: migration öncesi duplicate kontrolü boş döndü (test verisi).
-- Sol-prefix (dispatchId) eski tek-kolon index'i kapsar → o index kaldırıldı (D-6).

-- DropIndex
DROP INDEX "subcontractor_dispatch_items_dispatchId_idx";

-- DropIndex
DROP INDEX "kartela_dispatch_items_dispatchId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_dispatch_items_dispatchId_rollId_key" ON "subcontractor_dispatch_items"("dispatchId", "rollId");

-- CreateIndex
CREATE UNIQUE INDEX "kartela_dispatch_items_dispatchId_rollId_key" ON "kartela_dispatch_items"("dispatchId", "rollId");
