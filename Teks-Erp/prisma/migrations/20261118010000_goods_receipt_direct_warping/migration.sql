-- FASON DEVERE D4c (2026-11-18) — K1: iplik tedarikçiden DOĞRUDAN devereciye. YALNIZ EKLEME: mal kabul fişine
-- doğrudan devere siparişi bağı, devere sevk başlığına kaynak fiş bağı (iz + fiş iptalinde sevk iptali).
-- Mevcut her satırda iki kolon NULL — yeni CHECK hiçbir satırı reddetmez.

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "directWarpingOrderId" UUID;

-- AlterTable
ALTER TABLE "subcontractor_dispatches" ADD COLUMN     "goodsReceiptId" UUID;

-- CreateIndex
CREATE INDEX "goods_receipts_directWarpingOrderId_idx" ON "goods_receipts"("directWarpingOrderId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_goodsReceiptId_idx" ON "subcontractor_dispatches"("goodsReceiptId");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_directWarpingOrderId_fkey" FOREIGN KEY ("directWarpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kaynak fiş bağı yalnız devere başlığında (`test_db_invariants` envanteri; birincil kapı serviste).
-- NOT VALID → VALIDATE: ekleme kilidi kısa, doğrulama satırları kilitlemeden tarar.
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_receipt_warping_ck" CHECK (
  "goodsReceiptId" IS NULL OR "warpingOrderId" IS NOT NULL
) NOT VALID;
ALTER TABLE "subcontractor_dispatches" VALIDATE CONSTRAINT "subcontractor_dispatches_receipt_warping_ck";
