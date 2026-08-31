-- CreateEnum
CREATE TYPE "YarnMovementKind" AS ENUM ('IN', 'OUT', 'ADJUST_IN', 'ADJUST_OUT');

-- CreateEnum
CREATE TYPE "PriceKind" AS ENUM ('PURCHASE', 'SALE');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED');

-- ⚠️ BURADA İKİ `DropForeignKey` SATIRI VARDI ve SİLİNDİ (bilinçli).
-- `rolls_sackId_shipmentId_consistency_fkey` ve `swatches_..._fkey` DEFERRABLE
-- composite FK'lerdir; Prisma datamodel'inde temsil edilemedikleri için
-- `migrate dev` bunları HER diff'te düşürmek ister. Uygulansaydı çuval↔sevkiyat
-- tutarlılık seddi sessizce kalkardı. Bkz. schema.prisma:2557-2558 ve
-- Teks-Erp/CLAUDE.md perf kuralı 4.

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "purchaseOrderId" UUID;

-- CreateTable
CREATE TABLE "yarn_stocks" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "balanceKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "yarn_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yarn_movements" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "kind" "YarnMovementKind" NOT NULL,
    "qtyKg" DECIMAL(14,3) NOT NULL,
    "goodsReceiptId" UUID,
    "invoiceId" UUID,
    "reason" VARCHAR(300),
    "userId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yarn_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_prices" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "customerId" UUID,
    "kind" "PriceKind" NOT NULL,
    "currency" "Currency" NOT NULL,
    "price" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "item_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "orderNo" VARCHAR(32) NOT NULL,
    "supplierId" UUID NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'OPEN',
    "orderDate" TIMESTAMPTZ NOT NULL,
    "expectedDate" TIMESTAMPTZ,
    "notes" VARCHAR(500),
    "clientToken" UUID,
    "createdById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(14,4),
    "notes" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "yarn_stocks_warehouseId_idx" ON "yarn_stocks"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "yarn_stocks_itemId_warehouseId_key" ON "yarn_stocks"("itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "yarn_movements_itemId_warehouseId_createdAt_idx" ON "yarn_movements"("itemId", "warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "yarn_movements_warehouseId_createdAt_idx" ON "yarn_movements"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "yarn_movements_goodsReceiptId_idx" ON "yarn_movements"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "yarn_movements_invoiceId_idx" ON "yarn_movements"("invoiceId");

-- CreateIndex
CREATE INDEX "item_prices_customerId_idx" ON "item_prices"("customerId");

-- ⚠️ İKİ PARTIAL UNIQUE — düz unique DEĞİL, ve sebebi NULL semantiğidir.
-- `customerId IS NULL` = KART VARSAYILANI. Postgres'te NULL'lar birbirine eşit
-- SAYILMAZ, yani düz `UNIQUE(itemId, kind, currency)` bile aynı kaleme İKİ
-- varsayılan fiyat satırı doğmasına izin verirdi (ikisi de customerId=NULL) ve
-- `resolveItemPrice` hangisini seçtiğini kimse söyleyemezdi — hata çıkmaz,
-- yalnız fatura bazen bir fiyatla bazen diğeriyle açılır.
--
-- Şemada bunlar `@@unique` olarak DURUR: Prisma 7 predicate (WHERE) farkını
-- drift saymaz ama index↔unique farkını SAYAR (perf kuralı 4). Bu yüzden
-- Prisma'nın ürettiği düz unique burada DROP + partial CREATE ile değiştirilir.
-- Envantere de yazıldı: scripts/test_db_invariants.ts.

-- CreateIndex (partial: kart varsayılanı TEK olsun)
DROP INDEX IF EXISTS "item_price_default_uq";
CREATE UNIQUE INDEX "item_price_default_uq" ON "item_prices"("itemId", "kind", "currency")
  WHERE "customerId" IS NULL;

-- CreateIndex (partial: müşteri istisnası TEK olsun)
DROP INDEX IF EXISTS "item_price_customer_uq";
CREATE UNIQUE INDEX "item_price_customer_uq" ON "item_prices"("itemId", "customerId", "kind", "currency")
  WHERE "customerId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_orderNo_key" ON "purchase_orders"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_clientToken_key" ON "purchase_orders"("clientToken");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_status_idx" ON "purchase_orders"("supplierId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_status_orderDate_idx" ON "purchase_orders"("status", "orderDate");

-- CreateIndex
CREATE INDEX "purchase_order_lines_itemId_idx" ON "purchase_order_lines"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchaseOrderId_lineNo_key" ON "purchase_order_lines"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "goods_receipts_purchaseOrderId_idx" ON "goods_receipts"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_stocks" ADD CONSTRAINT "yarn_stocks_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_stocks" ADD CONSTRAINT "yarn_stocks_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- CHECK KISITLARI — sayısal invariant'lar DB'de kilitlenir
-- =============================================================================
-- ⚠️ Neden uygulama katmanı YETMEZ: bu tablolara ileride toplu script, veri
-- göçü ya da ikinci bir servis yazabilir. Defterin "miktar pozitiftir" kuralı
-- servis koduna değil satırın kendisine ait (`cheque`/`payment_allocation`
-- emsali). Envanter: scripts/test_db_invariants.ts.

-- Hareket miktarı HER ZAMAN pozitif; yönü `kind` söyler. Sıfır da yasak:
-- "hiçbir şey olmadı" bir defter satırı değildir.
ALTER TABLE "yarn_movements"
  ADD CONSTRAINT "yarn_movements_qty_positive" CHECK ("qtyKg" > 0);

-- Bakiye NEGATİF OLABİLİR ve bu bilinçlidir: sayım henüz girilmemişken çıkış
-- yapılırsa gerçek eksi bakiyedir ve GÖRÜNMELİDİR. Sıfıra kırpmak, eksiği
-- gizleyip envanteri sessizce yanlışlardı. Bu yüzden burada CHECK YOK.

-- Fiyat negatif olamaz. Sıfır SERBEST: promosyon/numune satırı meşrudur.
ALTER TABLE "item_prices"
  ADD CONSTRAINT "item_prices_price_nonneg" CHECK ("price" >= 0);

-- Sipariş kalemi: miktar pozitif, kabul edilen negatif olamaz.
-- ⚠️ `receivedQty <= qty` CHECK'i BİLİNÇLİ OLARAK YOK: fiziksel olarak fazla
-- mal GELEBİLİR ve kayıt gerçeği yazmalıdır. Servis uyarır, DB engellemez —
-- aksi halde depocu gelen malı sisteme HİÇ giremezdi.
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_received_nonneg" CHECK ("receivedQty" >= 0);
