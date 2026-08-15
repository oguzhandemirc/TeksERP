-- Saha planı C2 + C4 (2026-08-15).
-- C4: alış HER cariden — GoodsReceipt + PurchaseOrder'a fason tedarikçi bacağı
--     (supplierId ile XOR; guard SERVİSTE — iki kolonlu CHECK yazılmadı çünkü
--     test_db_invariants envanter yükü + XOR kuralının mesajlı 400'ü serviste
--     zaten tek kapıda). PO.supplierId NULLABLE oldu (DROP NOT NULL —
--     metadata-only).
-- C2: GoodsReceipt.rawStockEntry — fiş seviyesinde "ham stok olarak al"
--     (varsayılan false → mevcut davranış bayt-bayt). PG11+ DEFAULT'lu NOT NULL
--     ekleme attmissingval ile metadata-only'dir (tablo yeniden yazılmaz).

ALTER TABLE "goods_receipts" ADD COLUMN "subcontractorId" UUID;
ALTER TABLE "goods_receipts" ADD COLUMN "rawStockEntry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_subcontractorId_fkey"
  FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "goods_receipts_subcontractorId_createdAt_idx"
  ON "goods_receipts"("subcontractorId", "createdAt");

ALTER TABLE "purchase_orders" ALTER COLUMN "supplierId" DROP NOT NULL;
ALTER TABLE "purchase_orders" ADD COLUMN "subcontractorId" UUID;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_subcontractorId_fkey"
  FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "purchase_orders_subcontractorId_status_idx"
  ON "purchase_orders"("subcontractorId", "status");
