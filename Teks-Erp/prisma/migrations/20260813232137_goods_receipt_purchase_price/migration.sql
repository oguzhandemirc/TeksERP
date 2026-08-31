-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'TRY';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "goodsReceiptId" UUID;

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "purchasePrice" DECIMAL(14,4);

-- CreateIndex
CREATE INDEX "invoices_goodsReceiptId_idx" ON "invoices"("goodsReceiptId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ŞEMA-DIŞI SED: bir mal kabul fişi → EN ÇOK BİR AKTİF alış faturası.
-- Diğer kaynak bağlarıyla (sevkiyat/iade/fason kabul) AYNI kural: aynı fiş iki
-- kez faturalanırsa tedarikçiye borç sessizce iki katına çıkar ve fark ancak
-- mutabakatta anlaşılır. status <> CANCELLED: iptal edilen fatura yenisini
-- ENGELLEMEZ (storno'nun tüm amacı).
CREATE UNIQUE INDEX "invoices_one_active_per_goods_receipt"
  ON "invoices" ("goodsReceiptId")
  WHERE "goodsReceiptId" IS NOT NULL AND "status" <> 'CANCELLED';

-- Alış fiyatı negatif olamaz (0 meşru: bedelsiz numune/hediye mal).
ALTER TABLE "rolls"
  ADD CONSTRAINT "rolls_purchase_price_nonneg"
  CHECK ("purchasePrice" IS NULL OR "purchasePrice" >= 0);
