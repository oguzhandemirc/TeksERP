-- Devere ek E1 — dönüş kabul belgesi (tek irsaliye, N sipariş). Yalnız EKLEME.

-- AlterTable
ALTER TABLE "warp_beams" ADD COLUMN     "warpingReceiveDocId" UUID;

-- CreateTable
CREATE TABLE "warping_receive_docs" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(64) NOT NULL,
    "clientToken" UUID NOT NULL,
    "subcontractorId" UUID NOT NULL,
    "deliveryNoteNo" VARCHAR(64),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warping_receive_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warping_receive_docs_docNo_key" ON "warping_receive_docs"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "warping_receive_docs_clientToken_key" ON "warping_receive_docs"("clientToken");

-- CreateIndex
CREATE INDEX "warping_receive_docs_subcontractorId_deliveryNoteNo_idx" ON "warping_receive_docs"("subcontractorId", "deliveryNoteNo");

-- CreateIndex
CREATE INDEX "warping_receive_docs_createdAt_idx" ON "warping_receive_docs"("createdAt");

-- CreateIndex
CREATE INDEX "warp_beams_warpingReceiveDocId_idx" ON "warp_beams"("warpingReceiveDocId");

-- AddForeignKey
ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_warpingReceiveDocId_fkey" FOREIGN KEY ("warpingReceiveDocId") REFERENCES "warping_receive_docs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warping_receive_docs" ADD CONSTRAINT "warping_receive_docs_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Belgeye bağlı sarım bir kabul anahtarı taşır (belge yalnız grup başlığı; LIFO/fatura birimi sipariş başı anahtar).
ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_receive_doc_ck" CHECK ("warpingReceiveDocId" IS NULL OR "warpingReceiptKey" IS NOT NULL);
