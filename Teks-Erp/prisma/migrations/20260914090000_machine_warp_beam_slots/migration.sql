-- =============================================================================
-- LEVENT YUVA SAYISI — `machines.warpBeamSlots` (Faz 1b F4, 2026-09-14)
-- =============================================================================
-- GİRDİ ekseni; `productionLineCount` ÇIKTI eksenidir ve ikisi bağımsızdır (tasarım
-- §10/#23). Duruş kaydı `warpBeamSlots > 1` olan makinede hangi yuva sorar
-- (`MachineStopEvent.beamSlot` ∈ 1..warpBeamSlots); `<= 1` ise alan çizilmez.
-- CHECK `>= 0`: karşı örnek BULUNDU (cağlıktan beslenen çözgü makinesinde yuva 0) —
-- karşı örnek varsa ölçüm kazanır (`productionLineCount`taki `>= 1` ile çelişmez).
-- `DEFAULT 1` = bugünkü davranış: tek leventli tezgah, beamSlot sorulmaz.
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.

ALTER TABLE "machines"
  ADD COLUMN "warpBeamSlots" SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE "machines" ADD CONSTRAINT "machines_warp_beam_slots_nonneg"
  CHECK ("warpBeamSlots" >= 0);
