-- =============================================================================
-- WOUND ↔ fason iplik kalemi bağı (G1c, 2026-09-15, 01) — `warp_beam_events_fason_item_ck` genişler
-- =============================================================================
-- Hüküm 1e H5: fasona SARDIRILAN (originKind=SUBCONTRACT) leventin doğuş olayı (`WOUND`) o fasoncuya
--   giden İPLİK kalemine (`subcontractor_dispatch_items.kind=YARN`) OPSİYONEL bağlanır; fasondaki iplik
--   bakiyesi (türetilmiş) sarılan leventin `theoreticalKg`'sını ayrı kalem olarak düşer.
-- CHECK bayt bayt korunur, tek kol açılır:
--   ESKİ: (kind ∈ fason4) ⇔ (dispatchItemId NOT NULL)
--   YENİ: (kind ∈ fason4) ⇒ NOT NULL  ∧  (NOT NULL) ⇒ kind ∈ fason4 ∪ {WOUND}
--   ⇒ fason satırı bağsız YİNE yazılamaz; WOUND dışı hiçbir tür bağ taşıyamaz; WOUND bağlı ya da bağsız.
--   Kalemin TÜRÜ (YARN) DB'de doğrulanamaz (çapraz tablo) — servis kapısı (`windWarpBeam`, 400).
-- ADDITIVE (veri dokunmaz); İDEMPOTENT: DROP IF EXISTS + DO-EXCEPTION.
ALTER TABLE "warp_beam_events" DROP CONSTRAINT IF EXISTS "warp_beam_events_fason_item_ck";
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_fason_item_ck" CHECK (
    (("kind" IN ('SHIP_OUT', 'SHIP_OUT_CANCEL', 'RETURNED_IN', 'RETURNED_IN_CANCEL')) = ("dispatchItemId" IS NOT NULL))
    OR "kind" = 'WOUND'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
