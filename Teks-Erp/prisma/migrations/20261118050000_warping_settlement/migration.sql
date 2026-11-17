-- FASON DEVERE D5b (2026-11-18) — sipariş KAPANIŞ/YENİDEN AÇMA defteri + kapanış FİRE defteri (append-only).
-- YALNIZ EKLEME: mevcut tablo ve satırlara dokunulmaz; iki yeni tablo boş doğar.

-- CreateTable
CREATE TABLE "warping_order_settlements" (
    "id" UUID NOT NULL,
    "warpingOrderId" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "reversesId" UUID,
    "clientToken" UUID,
    "requestHash" VARCHAR(64),
    "reason" VARCHAR(300),
    "wastePct" DECIMAL(7,2),
    "tolerancePct" DECIMAL(5,2),
    "overTolerance" BOOLEAN NOT NULL DEFAULT false,
    "returnMovementIds" UUID[],
    "backTransferIds" UUID[],
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warping_order_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warping_yarn_wastes" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "warpingOrderId" UUID NOT NULL,
    "dispatchItemId" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "qtyKg" DECIMAL(14,3) NOT NULL,
    "overTolerance" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(300),
    "reversesId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warping_yarn_wastes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warping_order_settlements_reversesId_key" ON "warping_order_settlements"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "warping_order_settlements_clientToken_key" ON "warping_order_settlements"("clientToken");

-- CreateIndex
CREATE INDEX "warping_order_settlements_warpingOrderId_createdAt_idx" ON "warping_order_settlements"("warpingOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "warping_yarn_wastes_reversesId_key" ON "warping_yarn_wastes"("reversesId");

-- CreateIndex
CREATE INDEX "warping_yarn_wastes_settlementId_idx" ON "warping_yarn_wastes"("settlementId");

-- CreateIndex
CREATE INDEX "warping_yarn_wastes_warpingOrderId_createdAt_idx" ON "warping_yarn_wastes"("warpingOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "warping_yarn_wastes_dispatchItemId_createdAt_idx" ON "warping_yarn_wastes"("dispatchItemId", "createdAt");

-- AddForeignKey
ALTER TABLE "warping_order_settlements" ADD CONSTRAINT "warping_order_settlements_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_settlements" ADD CONSTRAINT "warping_order_settlements_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "warping_order_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_yarn_wastes" ADD CONSTRAINT "warping_yarn_wastes_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "warping_order_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_yarn_wastes" ADD CONSTRAINT "warping_yarn_wastes_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_yarn_wastes" ADD CONSTRAINT "warping_yarn_wastes_dispatchItemId_fkey" FOREIGN KEY ("dispatchItemId") REFERENCES "subcontractor_dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_yarn_wastes" ADD CONSTRAINT "warping_yarn_wastes_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "warping_yarn_wastes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Şema-dışı seddi (`test_db_invariants` envanteri): tür kümesi + ters bağ iki yönlü, kg > 0, oran aralığı.
ALTER TABLE "warping_order_settlements" ADD CONSTRAINT "warping_order_settlements_kind_ck"
  CHECK (("kind" = 'SETTLE' AND "reversesId" IS NULL) OR ("kind" = 'REOPEN' AND "reversesId" IS NOT NULL AND "clientToken" IS NULL));
ALTER TABLE "warping_order_settlements" ADD CONSTRAINT "warping_order_settlements_pct_ck"
  CHECK (("wastePct" IS NULL OR ("wastePct" >= 0 AND "wastePct" <= 100)) AND ("tolerancePct" IS NULL OR ("tolerancePct" >= 0 AND "tolerancePct" < 100)));
ALTER TABLE "warping_yarn_wastes" ADD CONSTRAINT "warping_yarn_wastes_kind_ck"
  CHECK (("kind" = 'WASTE' AND "reversesId" IS NULL) OR ("kind" = 'WASTE_CANCEL' AND "reversesId" IS NOT NULL));
ALTER TABLE "warping_yarn_wastes" ADD CONSTRAINT "warping_yarn_wastes_qty_ck" CHECK ("qtyKg" > 0);
