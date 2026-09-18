-- n İRSALİYE → 1 FATURA (2026-09-18) — şema YALNIZ EKLER: pivot `invoice_to_goods_receipts`; `invoices.goodsReceiptId`
-- kolonu KALIR (tek fişte ayrıca yazılır, eski istemci/okuyucu). Bugünkü tekil bağlar pivota BACKFILL edilir.
-- İDEMPOTENT (deploy-kurulum.md): IF NOT EXISTS · pg_constraint korumalı FK · backfill ON CONFLICT DO NOTHING.
-- ⚠️ `migrate diff` çıktısındaki DropForeignKey satırları (rolls/swatches DEFERRABLE FK) BİLEREK atıldı.

-- CreateTable
CREATE TABLE IF NOT EXISTS "invoice_to_goods_receipts" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "goodsReceiptId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_to_goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoice_to_goods_receipts_goodsReceiptId_idx" ON "invoice_to_goods_receipts"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_to_goods_receipts_invoiceId_goodsReceiptId_key" ON "invoice_to_goods_receipts"("invoiceId", "goodsReceiptId");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_to_goods_receipts_invoiceId_fkey') THEN
    ALTER TABLE "invoice_to_goods_receipts" ADD CONSTRAINT "invoice_to_goods_receipts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_to_goods_receipts_goodsReceiptId_fkey') THEN
    ALTER TABLE "invoice_to_goods_receipts" ADD CONSTRAINT "invoice_to_goods_receipts_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- BACKFILL: bugünkü tekil bağlar pivota (iptal edilmişler dahil — pivot bağı, "aktif" kararı fatura durumundan okunur).
INSERT INTO "invoice_to_goods_receipts" ("id", "invoiceId", "goodsReceiptId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), i."id", i."goodsReceiptId", i."createdAt", CURRENT_TIMESTAMP
FROM "invoices" i
WHERE i."goodsReceiptId" IS NOT NULL
ON CONFLICT ("invoiceId", "goodsReceiptId") DO NOTHING;
