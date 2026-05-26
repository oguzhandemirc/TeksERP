-- Eski globally unique constraint kaldır (cancelled receipt'in item satırı
-- aynı rollId'yi tutuyor → yeni receipt aynı top'u kabul edemiyordu).
-- Composite (receiptId, newRollId) — audit izi korunur, sadece aktif receipt
-- içinde tek satır olur.

-- DropIndex
DROP INDEX IF EXISTS "subcontractor_receipt_items_newRollId_key";

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_receipt_items_receiptId_newRollId_key" ON "subcontractor_receipt_items"("receiptId", "newRollId");
