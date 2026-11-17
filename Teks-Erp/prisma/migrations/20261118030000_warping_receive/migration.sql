-- FASON DEVERE D5a (2026-11-18) — devereciden dönen levent kabulü + iplik dağıtım defteri. YALNIZ EKLEME: üç nullable
-- kolon (mevcut satırlar NULL, yeni CHECK'leri ihlal etmez) + boş doğan append-only tablo.

-- AlterTable
ALTER TABLE "warp_beam_events" ADD COLUMN     "deliveryNoteNo" VARCHAR(64);

-- AlterTable
ALTER TABLE "warp_beams" ADD COLUMN     "warpingOrderId" UUID,
ADD COLUMN     "warpingReceiptKey" UUID;

-- CreateTable
CREATE TABLE "warp_beam_yarn_allocations" (
    "id" UUID NOT NULL,
    "eventYarnId" UUID NOT NULL,
    "dispatchItemId" UUID NOT NULL,
    "warpingOrderId" UUID NOT NULL,
    "holderWarpingOrderId" UUID NOT NULL,
    "kg" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warp_beam_yarn_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warp_beam_yarn_allocations_dispatchItemId_idx" ON "warp_beam_yarn_allocations"("dispatchItemId");

-- CreateIndex
CREATE INDEX "warp_beam_yarn_allocations_warpingOrderId_idx" ON "warp_beam_yarn_allocations"("warpingOrderId");

-- CreateIndex
CREATE INDEX "warp_beam_yarn_allocations_holderWarpingOrderId_idx" ON "warp_beam_yarn_allocations"("holderWarpingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "warp_beam_yarn_allocations_eventYarnId_dispatchItemId_holde_key" ON "warp_beam_yarn_allocations"("eventYarnId", "dispatchItemId", "holderWarpingOrderId");

-- CreateIndex
CREATE INDEX "warp_beams_warpingOrderId_idx" ON "warp_beams"("warpingOrderId");

-- CreateIndex
CREATE INDEX "warp_beams_warpingReceiptKey_idx" ON "warp_beams"("warpingReceiptKey");

-- AddForeignKey
ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warp_beam_yarn_allocations" ADD CONSTRAINT "warp_beam_yarn_allocations_eventYarnId_fkey" FOREIGN KEY ("eventYarnId") REFERENCES "warp_beam_event_yarns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warp_beam_yarn_allocations" ADD CONSTRAINT "warp_beam_yarn_allocations_dispatchItemId_fkey" FOREIGN KEY ("dispatchItemId") REFERENCES "subcontractor_dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warp_beam_yarn_allocations" ADD CONSTRAINT "warp_beam_yarn_allocations_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warp_beam_yarn_allocations" ADD CONSTRAINT "warp_beam_yarn_allocations_holderWarpingOrderId_fkey" FOREIGN KEY ("holderWarpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Şema-dışı seddler (envanter: scripts/test_db_invariants.ts)
-- Devere doğumu: sipariş ⇔ kabul anahtarı, köken fason ve devereci dolu.
ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_warping_order_ck" CHECK (
  ("warpingOrderId" IS NULL AND "warpingReceiptKey" IS NULL)
  OR ("warpingOrderId" IS NOT NULL AND "warpingReceiptKey" IS NOT NULL AND "originKind" = 'SUBCONTRACT' AND "subcontractorId" IS NOT NULL)
);
ALTER TABLE "warp_beam_yarn_allocations" ADD CONSTRAINT "warp_beam_yarn_allocations_kg_ck" CHECK ("kg" > 0);
