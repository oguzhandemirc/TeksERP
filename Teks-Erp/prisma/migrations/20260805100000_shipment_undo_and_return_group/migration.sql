-- Sevk geri alma (storno) + çok kalemli iade belgesi — 2026-08-05
--
-- İki nullable kolon; PG11+'ta DEFAULT'suz nullable kolon eklemek metadata-only'dir
-- (tablo yeniden yazılmaz). Veri dönüşümü / geri doldurma YOK.
--
-- ⚠️ `prisma migrate dev` bu diff'i üretirken `rolls_sackId_shipmentId_consistency_fkey`
-- ve `swatches_sackId_shipmentId_consistency_fkey` DEFERRABLE composite FK'larını
-- DROP etmek ister (datamodel'de temsil edilemiyorlar). O iki satır BİLİNÇLİ olarak
-- silindi — bkz. schema.prisma ve Teks-Erp/CLAUDE.md "sacks composite FK drift'i".

-- AlterTable: sevk öncesi statü snapshot'ı (storno topu eski rafına koysun)
ALTER TABLE "rolls" ADD COLUMN "preShipStatus" "RollStatus";

-- AlterTable: çok kalemli iadenin grup anahtarı (lider RollReturn.id)
ALTER TABLE "roll_returns" ADD COLUMN "returnGroupId" UUID;

-- CreateIndex: PARTIAL — tekil iadelerde kolon NULL kalır (null-yoğun, perf kuralı 4).
-- Şemada düz `@@index([returnGroupId])` durur; Prisma 7 predicate farkını drift SAYMAZ.
-- Envanteri: scripts/test_db_invariants.ts
CREATE INDEX "roll_returns_returnGroupId_idx" ON "roll_returns"("returnGroupId")
  WHERE "returnGroupId" IS NOT NULL;
