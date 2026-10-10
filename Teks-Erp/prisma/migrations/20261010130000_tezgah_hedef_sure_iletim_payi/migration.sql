-- =============================================================================
-- Tezgah Salonu gerçek veri dilimi — sebep HEDEF SÜRESİ + duruşa DONAN hedef/pay
-- =============================================================================
-- NE YAPIYOR (ADDITIVE — yalnız nullable kolon + CHECK; backfill YOK):
--   ① `reason_presets."targetMinutes"` — [PROFİL] sebep başına hedef süre (dk).
--      NULL = süre izlenmez, kimseye iletilmez (varsayılan = bugünkü davranış).
--      CHECK `reason_presets_stop_target_chk`: dolu ise yalnız MACHINE_STOP, sınıfı
--      NON_SCHEDULED değil (plan dışı süre izlenmez) ve 1..1440.
--   ② `machine_stop_events."targetMinutes"` + `"escalationGraceMinutes"` — açık
--      duruş başladığı andaki hedef + iletim payıyla değerlendirilir (geçmiş
--      etkilenmez). CHECK `machine_stop_events_escalation_chk`: hedef 1..1440,
--      pay 0..1440.
-- Mevcut satırların hepsi NULL ⇒ iki CHECK de mevcut veriyi geçirir; NOT VALID ve
-- statement_timeout GEREKMEZ. İki model de BaseController'dan yazılmaz (yazıcılar
-- reason-preset.service + machine-stop.service) ⇒ kolonlar gövdeden yazılabilir DEĞİL.
-- İdempotent: IF NOT EXISTS + pg_constraint yoklaması.
-- =============================================================================

ALTER TABLE "reason_presets" ADD COLUMN IF NOT EXISTS "targetMinutes" INTEGER;

ALTER TABLE "machine_stop_events" ADD COLUMN IF NOT EXISTS "targetMinutes" INTEGER;
ALTER TABLE "machine_stop_events" ADD COLUMN IF NOT EXISTS "escalationGraceMinutes" INTEGER;

DO $tezgah_hedef$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reason_presets_stop_target_chk') THEN
    ALTER TABLE "reason_presets" ADD CONSTRAINT "reason_presets_stop_target_chk"
      CHECK ("targetMinutes" IS NULL OR (
        "kind" = 'MACHINE_STOP'
        AND "stopLossClass" IS DISTINCT FROM 'NON_SCHEDULED'
        AND "targetMinutes" BETWEEN 1 AND 1440
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'machine_stop_events_escalation_chk') THEN
    ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_escalation_chk"
      CHECK (
        ("targetMinutes" IS NULL OR "targetMinutes" BETWEEN 1 AND 1440)
        AND ("escalationGraceMinutes" IS NULL OR "escalationGraceMinutes" BETWEEN 0 AND 1440)
      );
  END IF;
END
$tezgah_hedef$;
