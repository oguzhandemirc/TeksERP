-- Faz 7 — Y-1 (GoodsReceipt: ham kumaş mal kabul / izlenebilirlik kökü) + O-19 (operatör izi)
-- TÜMÜ ADDITIVE nullable — mevcut akışları BOZMAZ. App-code entegrasyonu (KK1 girişinde
-- GoodsReceipt oluşturma/bağlama; markReady/dispatch/tartıda kullanıcı damgalama) AYRI iştir
-- (backend track / follow-up); bu migration yalnız DB foundation'ını kurar.
SET statement_timeout = 0;

-- ============================================================================
-- Y-1: GoodsReceipt (tedarikçi + irsaliye no + tarih). Tedarikçi = Customer(type=SUPPLIER).
-- ============================================================================
CREATE TABLE "goods_receipts" (
  "id"           UUID NOT NULL,
  "receiptNo"    VARCHAR(64) NOT NULL,
  "supplierId"   UUID NOT NULL,
  "deliveryNote" VARCHAR(64),
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedById" UUID,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "goods_receipts_receiptNo_key" ON "goods_receipts" ("receiptNo");
CREATE INDEX "goods_receipts_supplierId_idx" ON "goods_receipts" ("supplierId");
CREATE INDEX "goods_receipts_receivedAt_idx" ON "goods_receipts" ("receivedAt");
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Roll: goodsReceiptId (hangi teslimat) + supplierLotNo (per-roll lot). İzlenebilirlik kökü.
-- goodsReceiptId indexli (recall: teslimata göre); supplierLotNo PARTIAL (null-yoğun).
ALTER TABLE "rolls" ADD COLUMN "goodsReceiptId" UUID;
ALTER TABLE "rolls" ADD COLUMN "supplierLotNo"  VARCHAR(64);
CREATE INDEX "rolls_goodsReceiptId_idx" ON "rolls" ("goodsReceiptId");
CREATE INDEX "rolls_supplierLotNo_idx"  ON "rolls" ("supplierLotNo") WHERE "supplierLotNo" IS NOT NULL;
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_goodsReceiptId_fkey"
  FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- O-19: Sevkiyat/tartı operatör izi. Düşük-trafik "kim yaptı" audit FK'ları —
-- CLAUDE.md kural 1 istisnası gereği INDEX EKLENMEZ (sorgu yolu doğarsa eklenir).
-- ============================================================================
ALTER TABLE "shipments" ADD COLUMN "readyById"      UUID;
ALTER TABLE "shipments" ADD COLUMN "dispatchedById" UUID;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_readyById_fkey"
  FOREIGN KEY ("readyById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_dispatchedById_fkey"
  FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sacks" ADD COLUMN "weighedById" UUID;
ALTER TABLE "sacks" ADD COLUMN "weighedAt"   TIMESTAMP(3);
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_weighedById_fkey"
  FOREIGN KEY ("weighedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
