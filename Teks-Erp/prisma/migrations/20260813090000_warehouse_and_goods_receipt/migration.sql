-- =============================================================================
-- TİCARET PAKETİ — ÇOKLU DEPO + MAL KABUL (2026-08-13)
-- Tasarım: docs/design/TICARET-PAKETI-TASARIM.md
-- =============================================================================
-- TAMAMI EKLEMELİ. Mevcut hiçbir kolon/kısıt değişmiyor, hiçbir satır güncellenmiyor
-- → canlı fabrikada davranış bayt-bayt aynı kalır. `rolls`a eklenen iki kolon da
-- NULLABLE ve VARSAYILANSIZ: PG11+'ta metadata-only, tablo YENİDEN YAZILMAZ
-- (emsal ölçüm: 20260804210000 aynı tabloda 6 ms).
--
-- ⚠️ Bu dosya ELLE yazıldı (partial index + enum içerir; ayrıca `migrate dev`
-- rolls/swatches composite FK'larını her diff'te DROP etmek ister —
-- schema.prisma:2557-2558). Uygulama sırası: git add → prisma db execute →
-- migrate resolve --applied → DOĞRULA (\d+ warehouses; \d+ rolls).
--
-- ⚠️ Varsayılan depo satırı BURADA OLUŞTURULMAZ: boot uzlaştırması üretir
-- (`ensureDefaultWarehouse`, izin kataloğu job'u emsali). Migration'a INSERT
-- gömmek uuid/adı taşa yazar ve taze kurulum seed'iyle çatallanır.
-- =============================================================================

-- CreateEnum — yeni değer SONA eklenir (ALTER TYPE ADD VALUE sıra kuralı).
-- Değer bu migration'da KULLANILMIYOR (PG aynı tx içinde kullanıma izin vermez).
ALTER TYPE "RollEntrySource" ADD VALUE 'PURCHASE_RECEIPT';

-- CreateEnum
CREATE TYPE "WarehouseEventType" AS ENUM ('ENTRY', 'TRANSFER', 'TRANSFER_REVERSAL', 'SHIPMENT', 'SHIPMENT_REVERSAL', 'RETURN', 'CANCEL');

-- CreateEnum
CREATE TYPE "WarehouseTransferStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "address" VARCHAR(300),
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_transfers" (
    "id" UUID NOT NULL,
    "transferNo" VARCHAR(32) NOT NULL,
    "fromWarehouseId" UUID NOT NULL,
    "toWarehouseId" UUID NOT NULL,
    "status" "WarehouseTransferStatus" NOT NULL DEFAULT 'COMPLETED',
    "notes" VARCHAR(500),
    "clientToken" UUID,
    "createdById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warehouse_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "receiptNo" VARCHAR(32) NOT NULL,
    "warehouseId" UUID NOT NULL,
    "supplierId" UUID,
    "deliveryNoteNo" VARCHAR(64),
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" VARCHAR(500),
    "clientToken" UUID,
    "createdById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable — append-only defter (updatedAt YOK, konvansiyon).
CREATE TABLE "warehouse_movements" (
    "id" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "eventType" "WarehouseEventType" NOT NULL,
    "fromWarehouseId" UUID,
    "toWarehouseId" UUID,
    "qty" DECIMAL(12,3) NOT NULL,
    "transferId" UUID,
    "goodsReceiptId" UUID,
    "shipmentId" UUID,
    "rollReturnId" UUID,
    "userId" UUID,
    "notes" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_movements_pkey" PRIMARY KEY ("id")
);

-- AlterTable — iki nullable kolon (metadata-only).
ALTER TABLE "rolls" ADD COLUMN     "warehouseId" UUID,
                    ADD COLUMN     "goodsReceiptId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex — ⚠️ ŞEMA-DIŞI PARTIAL UNIQUE: sistemde YALNIZ BİR varsayılan depo.
-- Şemada `@@unique([isDefault])` olarak durur (Prisma 7 index↔unique farkını drift
-- SAYAR, predicate farkını saymaz — perf kuralı 4). Düz unique olsaydı sistemde
-- toplam İKİ depo tutulabilirdi. Envanter: scripts/test_db_invariants.ts
CREATE UNIQUE INDEX "warehouses_isDefault_key" ON "warehouses"("isDefault") WHERE "isDefault" = true;

-- CreateIndex
CREATE INDEX "warehouses_isActive_idx" ON "warehouses"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_transfers_transferNo_key" ON "warehouse_transfers"("transferNo");

-- CreateIndex — idempotency anahtarı; PARTIAL (çoğu satırda NULL olabilir).
CREATE UNIQUE INDEX "warehouse_transfers_clientToken_key" ON "warehouse_transfers"("clientToken") WHERE "clientToken" IS NOT NULL;

-- CreateIndex
CREATE INDEX "warehouse_transfers_fromWarehouseId_createdAt_idx" ON "warehouse_transfers"("fromWarehouseId", "createdAt");
CREATE INDEX "warehouse_transfers_toWarehouseId_createdAt_idx" ON "warehouse_transfers"("toWarehouseId", "createdAt");
CREATE INDEX "warehouse_transfers_status_createdAt_idx" ON "warehouse_transfers"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_receiptNo_key" ON "goods_receipts"("receiptNo");

-- CreateIndex — PARTIAL (idempotency; NULL satırlar aranmaz).
CREATE UNIQUE INDEX "goods_receipts_clientToken_key" ON "goods_receipts"("clientToken") WHERE "clientToken" IS NOT NULL;

-- CreateIndex
CREATE INDEX "goods_receipts_warehouseId_createdAt_idx" ON "goods_receipts"("warehouseId", "createdAt");
CREATE INDEX "goods_receipts_supplierId_createdAt_idx" ON "goods_receipts"("supplierId", "createdAt");
CREATE INDEX "goods_receipts_status_createdAt_idx" ON "goods_receipts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "warehouse_movements_rollId_createdAt_idx" ON "warehouse_movements"("rollId", "createdAt");
CREATE INDEX "warehouse_movements_toWarehouseId_eventType_createdAt_idx" ON "warehouse_movements"("toWarehouseId", "eventType", "createdAt");
CREATE INDEX "warehouse_movements_fromWarehouseId_eventType_createdAt_idx" ON "warehouse_movements"("fromWarehouseId", "eventType", "createdAt");

-- CreateIndex — PARTIAL: belge bağları çoğu satırda NULL (KK1/tambur girişleri belgesiz).
CREATE INDEX "warehouse_movements_transferId_idx" ON "warehouse_movements"("transferId") WHERE "transferId" IS NOT NULL;
CREATE INDEX "warehouse_movements_goodsReceiptId_idx" ON "warehouse_movements"("goodsReceiptId") WHERE "goodsReceiptId" IS NOT NULL;

-- CreateIndex — depo bazlı stok listesi ("X deposunda WAREHOUSE olan toplar").
CREATE INDEX "rolls_warehouseId_status_idx" ON "rolls"("warehouseId", "status");

-- CreateIndex — PARTIAL: yalnız mal kabulle doğmuş toplarda dolu.
CREATE INDEX "rolls_goodsReceiptId_idx" ON "rolls"("goodsReceiptId") WHERE "goodsReceiptId" IS NOT NULL;

-- AddForeignKey
-- ⚠️ RESTRICT, SET NULL DEĞİL (Prisma'nın opsiyonel ilişkilerdeki varsayılanı
-- SetNull'dır ve burada yanlış olurdu): depo silmek içindeki topları SESSİZCE
-- deposuz bırakırdı — ölçüldü, bekçi yakaladı (test_roll_warehouse_stamp).
-- Servis guard'ı dolu depoyu zaten silmiyor; bu satır o kuralı DB seddine çevirir.
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_transfers" ADD CONSTRAINT "warehouse_transfers_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "warehouse_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_rollReturnId_fkey" FOREIGN KEY ("rollReturnId") REFERENCES "roll_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
