-- Devere A1 (2026-11-20): devereci faturası ↔ devere dönüş KABULÜ pivotu (yalnız EKLEME).
-- Kabul başına tek aktif fatura servis kapısıdır (warping_orders FOR UPDATE); anahtar FK'siz (kabul ayrı tablo değil).

-- CreateTable
CREATE TABLE "invoice_to_warping_receipts" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "warpingOrderId" UUID NOT NULL,
    "warpingReceiptKey" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_to_warping_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_to_warping_receipts_warpingReceiptKey_idx" ON "invoice_to_warping_receipts"("warpingReceiptKey");

-- CreateIndex
CREATE INDEX "invoice_to_warping_receipts_warpingOrderId_idx" ON "invoice_to_warping_receipts"("warpingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_to_warping_receipts_invoiceId_warpingReceiptKey_key" ON "invoice_to_warping_receipts"("invoiceId", "warpingReceiptKey");

-- AddForeignKey
ALTER TABLE "invoice_to_warping_receipts" ADD CONSTRAINT "invoice_to_warping_receipts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_to_warping_receipts" ADD CONSTRAINT "invoice_to_warping_receipts_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
