-- RollVariance.sourceRollId — sapmayı DOĞURAN TOP (hüküm ② 2026-09-14, add-only).
-- `sourceRefId` BELGE kimliği kalır; top kimliği ayrı kolondadır (iki anlam tek kolonda okuyucuyu kör eder).
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ
--    (`migrate dev` diff'i onları DROP etmek ister; satırlar bilerek silindi).

-- AlterTable
ALTER TABLE "roll_variances" ADD COLUMN     "sourceRollId" UUID;

-- CreateIndex
CREATE INDEX "roll_variances_sourceRollId_idx" ON "roll_variances"("sourceRollId");

-- AddForeignKey
ALTER TABLE "roll_variances" ADD CONSTRAINT "roll_variances_sourceRollId_fkey" FOREIGN KEY ("sourceRollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
