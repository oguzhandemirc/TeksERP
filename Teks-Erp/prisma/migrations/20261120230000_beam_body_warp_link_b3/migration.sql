-- =============================================================================
-- DEVERE EK B3 — LEVENT GÖVDESİ ↔ SARIM BAĞI (2026-11-20)
-- =============================================================================
-- Yalnız EKLEME/gevşetme: iki boş kolon (NULL doğar), FK + index, iki yeni CHECK (mevcut satırların hepsi
-- sağlar: B1/B2 hiçbir gövdeyi dolu duruma ya da sarım türlü olaya yazmadı) ve olay türü CHECK'inin
-- GENİŞLETİLMESİ (+DISMOUNTED, +RETURNED_FULL; eski küme alt kümedir).
-- =============================================================================

-- AlterTable
ALTER TABLE "beam_bodies" ADD COLUMN     "currentWarpBeamId" UUID;

-- AlterTable
ALTER TABLE "warp_beams" ADD COLUMN     "beamBodyId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "beam_bodies_currentWarpBeamId_key" ON "beam_bodies"("currentWarpBeamId");

-- CreateIndex
CREATE INDEX "warp_beams_beamBodyId_idx" ON "warp_beams"("beamBodyId");

-- AddForeignKey
ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_beamBodyId_fkey" FOREIGN KEY ("beamBodyId") REFERENCES "beam_bodies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_currentWarpBeamId_fkey" FOREIGN KEY ("currentWarpBeamId") REFERENCES "warp_beams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Durum ↔ üstündeki sarım çifti: dolu durumlarda sarım dolu, ötekilerde boş.
ALTER TABLE "beam_bodies" ADD CONSTRAINT "beam_bodies_current_warp_ck"
  CHECK (("currentWarpBeamId" IS NOT NULL) = ("status" IN ('FULL_STOCK', 'MOUNTED', 'FULL_OUT')));

-- Olay türü evreni genişler (`BEAM_BODY_EVENT_KINDS` ↔ CHECK iki yönlü, `test_levent_govde`).
ALTER TABLE "beam_body_events" DROP CONSTRAINT IF EXISTS "beam_body_events_kind_ck";
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_kind_ck"
  CHECK ("kind" IN (
    'REGISTER', 'REGISTER_CANCEL',
    'SHIP_EMPTY', 'SHIP_EMPTY_CANCEL', 'RETURN_EMPTY', 'RETURN_EMPTY_CANCEL',
    'FILLED', 'FILLED_CANCEL', 'MOUNTED', 'MOUNTED_CANCEL', 'DISMOUNTED', 'DISMOUNTED_CANCEL',
    'EMPTIED', 'EMPTIED_CANCEL', 'SHIPPED_FULL', 'SHIPPED_FULL_CANCEL', 'RETURNED_FULL', 'RETURNED_FULL_CANCEL',
    'MAINTENANCE_IN', 'MAINTENANCE_IN_CANCEL', 'MAINTENANCE_OUT', 'MAINTENANCE_OUT_CANCEL', 'SCRAP', 'SCRAP_CANCEL',
    'RETURN_TO_OWNER', 'RETURN_TO_OWNER_CANCEL'
  ));

-- Sarım bağı yalnız sarım türlü olaylarda ve orada zorunlu (ters satır da sarımı kopyalar).
ALTER TABLE "beam_body_events" ADD CONSTRAINT "beam_body_events_warp_ck"
  CHECK (("warpBeamId" IS NOT NULL) = ("kind" IN (
    'FILLED', 'FILLED_CANCEL', 'MOUNTED', 'MOUNTED_CANCEL', 'DISMOUNTED', 'DISMOUNTED_CANCEL',
    'EMPTIED', 'EMPTIED_CANCEL', 'SHIPPED_FULL', 'SHIPPED_FULL_CANCEL', 'RETURNED_FULL', 'RETURNED_FULL_CANCEL'
  )));
