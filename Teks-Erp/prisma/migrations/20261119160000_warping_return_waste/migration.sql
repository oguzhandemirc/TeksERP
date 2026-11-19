-- Fason devere: iade penceresinde fire (iade firesi kapanışa bağlı değil) + iade ucunda idempotency.
-- Yalnız EKLEME/GEVŞETME: mevcut satırların hepsi settlementId dolu → yeni CHECK geriye dönük geçer.

-- AlterTable
ALTER TABLE "warping_yarn_wastes" ADD COLUMN     "returnMovementId" UUID,
ALTER COLUMN "settlementId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "yarn_movements" ADD COLUMN     "clientToken" UUID,
ADD COLUMN     "requestHash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "warping_yarn_wastes_returnMovementId_idx" ON "warping_yarn_wastes"("returnMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "yarn_movements_clientToken_key" ON "yarn_movements"("clientToken");

-- AddForeignKey
ALTER TABLE "warping_yarn_wastes" ADD CONSTRAINT "warping_yarn_wastes_returnMovementId_fkey" FOREIGN KEY ("returnMovementId") REFERENCES "yarn_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fire satırının kaynağı: kapanış/yeniden açma kaydı YA DA iade hareketi (ikisi birden olabilir değil, en az biri).
ALTER TABLE "warping_yarn_wastes" ADD CONSTRAINT "warping_yarn_wastes_source_ck"
  CHECK (("settlementId" IS NOT NULL) <> ("returnMovementId" IS NOT NULL));
