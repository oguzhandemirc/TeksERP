-- Devere Faz 4 — top tezgahtan doğar: CONSUMED.rollId + WarpSpec.takeUpPct (idempotent)
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "rollId" UUID;
CREATE INDEX IF NOT EXISTS "warp_beam_events_rollId_idx" ON "warp_beam_events"("rollId");
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_rollId_fkey"
    FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "warp_specs" ADD COLUMN IF NOT EXISTS "takeUpPct" DECIMAL(5,2);
DO $$ BEGIN
  ALTER TABLE "warp_specs" ADD CONSTRAINT "warp_specs_take_up_pct_range"
    CHECK ("takeUpPct" IS NULL OR ("takeUpPct" >= 0 AND "takeUpPct" < 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
