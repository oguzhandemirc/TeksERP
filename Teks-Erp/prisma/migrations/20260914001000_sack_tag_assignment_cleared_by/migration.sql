-- SackTagAssignment.clearedById — elle kaldırma SOFT oldu (2026-09-14, add-only).
-- `applyTagsTx` remove/removeAll satırı silmez, `clearedAt` damgalar; `clearedShipmentId`
-- NULL kalır (sevk temizliğinden ayrışır). Kim kaldırdı: `revokedAt`+`revokedById` deseni.
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.

-- AlterTable
ALTER TABLE "sack_tag_assignments" ADD COLUMN     "clearedById" UUID;

-- AddForeignKey
ALTER TABLE "sack_tag_assignments" ADD CONSTRAINT "sack_tag_assignments_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
