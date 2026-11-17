-- FASON DEVERE D4a (2026-11-17) — Fason Devere Siparişi. YALNIZ EKLEME: yeni iki enum + beş tablo; mevcut
-- hiçbir tabloya dokunulmaz. Şema-dışı seddiler en altta (`test_db_invariants` envanteri).


-- CreateEnum
CREATE TYPE "WarpingOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WarpingFeeUnit" AS ENUM ('METRE', 'KG', 'ENDS_METRE');


-- CreateTable
CREATE TABLE "warping_orders" (
    "id" UUID NOT NULL,
    "orderNo" VARCHAR(64) NOT NULL,
    "clientToken" UUID,
    "warpSpecId" UUID NOT NULL,
    "subcontractorId" UUID NOT NULL,
    "beamCount" INTEGER NOT NULL,
    "targetLengthM" DECIMAL(14,3) NOT NULL,
    "fixedWasteM" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "wasteTolerancePct" DECIMAL(5,2),
    "feeUnit" "WarpingFeeUnit" NOT NULL DEFAULT 'METRE',
    "feeUnitPrice" DECIMAL(12,4),
    "feeCurrency" "Currency",
    "expectedReturnAt" TIMESTAMPTZ,
    "notes" VARCHAR(500),
    "status" "WarpingOrderStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMPTZ,
    "completedById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warping_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warping_order_beam_lines" (
    "id" UUID NOT NULL,
    "warpingOrderId" UUID NOT NULL,
    "beamCount" INTEGER NOT NULL,
    "beamLengthM" DECIMAL(12,3) NOT NULL,
    "sortOrder" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warping_order_beam_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warping_order_yarns" (
    "id" UUID NOT NULL,
    "warpingOrderId" UUID NOT NULL,
    "yarnItemId" UUID NOT NULL,
    "sourceWarpSpecId" UUID NOT NULL,
    "endsCount" INTEGER NOT NULL,
    "denier" DECIMAL(10,4) NOT NULL,
    "wastePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "netKg" DECIMAL(14,3) NOT NULL,
    "grossKg" DECIMAL(14,3) NOT NULL,
    "sortOrder" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warping_order_yarns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warping_order_extra_specs" (
    "id" UUID NOT NULL,
    "warpingOrderId" UUID NOT NULL,
    "warpSpecId" UUID NOT NULL,
    "sortOrder" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warping_order_extra_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warping_order_to_orders" (
    "id" UUID NOT NULL,
    "warpingOrderId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warping_order_to_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warping_orders_orderNo_key" ON "warping_orders"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "warping_orders_clientToken_key" ON "warping_orders"("clientToken");

-- CreateIndex
CREATE INDEX "warping_orders_warpSpecId_idx" ON "warping_orders"("warpSpecId");

-- CreateIndex
CREATE INDEX "warping_orders_subcontractorId_createdAt_idx" ON "warping_orders"("subcontractorId", "createdAt");

-- CreateIndex
CREATE INDEX "warping_orders_status_createdAt_idx" ON "warping_orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "warping_orders_createdAt_idx" ON "warping_orders"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "warping_order_beam_lines_warpingOrderId_sortOrder_key" ON "warping_order_beam_lines"("warpingOrderId", "sortOrder");

-- CreateIndex
CREATE INDEX "warping_order_yarns_yarnItemId_idx" ON "warping_order_yarns"("yarnItemId");

-- CreateIndex
CREATE INDEX "warping_order_yarns_sourceWarpSpecId_idx" ON "warping_order_yarns"("sourceWarpSpecId");

-- CreateIndex
CREATE UNIQUE INDEX "warping_order_yarns_warpingOrderId_yarnItemId_key" ON "warping_order_yarns"("warpingOrderId", "yarnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "warping_order_yarns_warpingOrderId_sortOrder_key" ON "warping_order_yarns"("warpingOrderId", "sortOrder");

-- CreateIndex
CREATE INDEX "warping_order_extra_specs_warpSpecId_idx" ON "warping_order_extra_specs"("warpSpecId");

-- CreateIndex
CREATE UNIQUE INDEX "warping_order_extra_specs_warpingOrderId_warpSpecId_key" ON "warping_order_extra_specs"("warpingOrderId", "warpSpecId");

-- CreateIndex
CREATE UNIQUE INDEX "warping_order_extra_specs_warpingOrderId_sortOrder_key" ON "warping_order_extra_specs"("warpingOrderId", "sortOrder");

-- CreateIndex
CREATE INDEX "warping_order_to_orders_orderId_idx" ON "warping_order_to_orders"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "warping_order_to_orders_warpingOrderId_orderId_key" ON "warping_order_to_orders"("warpingOrderId", "orderId");

-- AddForeignKey
ALTER TABLE "warping_orders" ADD CONSTRAINT "warping_orders_warpSpecId_fkey" FOREIGN KEY ("warpSpecId") REFERENCES "warp_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_orders" ADD CONSTRAINT "warping_orders_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_beam_lines" ADD CONSTRAINT "warping_order_beam_lines_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_yarns" ADD CONSTRAINT "warping_order_yarns_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_yarns" ADD CONSTRAINT "warping_order_yarns_yarnItemId_fkey" FOREIGN KEY ("yarnItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_yarns" ADD CONSTRAINT "warping_order_yarns_sourceWarpSpecId_fkey" FOREIGN KEY ("sourceWarpSpecId") REFERENCES "warp_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_extra_specs" ADD CONSTRAINT "warping_order_extra_specs_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_extra_specs" ADD CONSTRAINT "warping_order_extra_specs_warpSpecId_fkey" FOREIGN KEY ("warpSpecId") REFERENCES "warp_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_to_orders" ADD CONSTRAINT "warping_order_to_orders_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_order_to_orders" ADD CONSTRAINT "warping_order_to_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Şema-dışı seddiler (`test_db_invariants` envanteri).
-- Özet > 0; fire/tolerans aralığı; fiyat varsa döviz zorunlu.
ALTER TABLE "warping_orders" ADD CONSTRAINT "warping_orders_qty_ck" CHECK ("beamCount" > 0 AND "targetLengthM" > 0 AND "fixedWasteM" >= 0 AND ("wasteTolerancePct" IS NULL OR ("wasteTolerancePct" >= 0 AND "wasteTolerancePct" < 100)));
ALTER TABLE "warping_orders" ADD CONSTRAINT "warping_orders_fee_ck" CHECK (("feeUnitPrice" IS NULL OR "feeUnitPrice" >= 0) AND ("feeUnitPrice" IS NULL OR "feeCurrency" IS NOT NULL));
-- Durum ↔ damga: COMPLETED ⇔ completedAt dolu · CANCELLED ⇔ cancelledAt dolu.
ALTER TABLE "warping_orders" ADD CONSTRAINT "warping_orders_status_ck" CHECK ((("status" = 'COMPLETED') = ("completedAt" IS NOT NULL)) AND (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)));
ALTER TABLE "warping_order_beam_lines" ADD CONSTRAINT "warping_order_beam_lines_qty_ck" CHECK ("beamCount" > 0 AND "beamLengthM" > 0 AND "sortOrder" >= 0);
ALTER TABLE "warping_order_yarns" ADD CONSTRAINT "warping_order_yarns_qty_ck" CHECK ("endsCount" > 0 AND "denier" > 0 AND "wastePct" >= 0 AND "wastePct" < 100 AND "netKg" >= 0 AND "grossKg" >= "netKg" AND "sortOrder" >= 0);
ALTER TABLE "warping_order_extra_specs" ADD CONSTRAINT "warping_order_extra_specs_sort_ck" CHECK ("sortOrder" >= 0);
