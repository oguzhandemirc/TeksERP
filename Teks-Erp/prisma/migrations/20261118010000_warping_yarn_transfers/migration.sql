-- FASON DEVERE D4b-2 (2026-11-18) — siparişler arası iplik AKTARMA defteri (append-only). YALNIZ EKLEME: mevcut
-- tablo ve satırlara dokunulmaz; yeni tablo boş doğar.

-- CreateTable
CREATE TABLE "warping_yarn_transfers" (
    "id" UUID NOT NULL,
    "dispatchItemId" UUID NOT NULL,
    "fromWarpingOrderId" UUID NOT NULL,
    "toWarpingOrderId" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "qtyKg" DECIMAL(14,3) NOT NULL,
    "reversesId" UUID,
    "batchId" UUID NOT NULL,
    "clientToken" UUID,
    "note" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warping_yarn_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warping_yarn_transfers_reversesId_key" ON "warping_yarn_transfers"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "warping_yarn_transfers_clientToken_key" ON "warping_yarn_transfers"("clientToken");

-- CreateIndex
CREATE INDEX "warping_yarn_transfers_dispatchItemId_createdAt_idx" ON "warping_yarn_transfers"("dispatchItemId", "createdAt");

-- CreateIndex
CREATE INDEX "warping_yarn_transfers_fromWarpingOrderId_createdAt_idx" ON "warping_yarn_transfers"("fromWarpingOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "warping_yarn_transfers_toWarpingOrderId_createdAt_idx" ON "warping_yarn_transfers"("toWarpingOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "warping_yarn_transfers_batchId_idx" ON "warping_yarn_transfers"("batchId");

-- AddForeignKey
ALTER TABLE "warping_yarn_transfers" ADD CONSTRAINT "warping_yarn_transfers_dispatchItemId_fkey" FOREIGN KEY ("dispatchItemId") REFERENCES "subcontractor_dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_yarn_transfers" ADD CONSTRAINT "warping_yarn_transfers_fromWarpingOrderId_fkey" FOREIGN KEY ("fromWarpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_yarn_transfers" ADD CONSTRAINT "warping_yarn_transfers_toWarpingOrderId_fkey" FOREIGN KEY ("toWarpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_yarn_transfers" ADD CONSTRAINT "warping_yarn_transfers_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "warping_yarn_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Şema-dışı seddi (`test_db_invariants` envanteri): tür kümesi + ters bağ iki yönlü, kg > 0, kaynak ≠ hedef.
ALTER TABLE "warping_yarn_transfers" ADD CONSTRAINT "warping_yarn_transfers_kind_ck"
  CHECK (("kind" = 'TRANSFER' AND "reversesId" IS NULL) OR ("kind" = 'TRANSFER_CANCEL' AND "reversesId" IS NOT NULL));
ALTER TABLE "warping_yarn_transfers" ADD CONSTRAINT "warping_yarn_transfers_qty_ck" CHECK ("qtyKg" > 0);
ALTER TABLE "warping_yarn_transfers" ADD CONSTRAINT "warping_yarn_transfers_orders_ck" CHECK ("fromWarpingOrderId" <> "toWarpingOrderId");
