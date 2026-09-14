-- =============================================================================
-- Devere FAZ 3 — tezgah bağı / tüketim / bitiş (3/3): iki yeni enum, WarpBeam durum kolonları,
-- olay kolonları, Station.consumesWarpBeam, kind_ck genişlemesi, yuva seddi, iki CHECK.
-- =============================================================================
-- Tasarım: DEVERE-LEVENT-TARAMASI §4.3/§4.4/§4.6/§4.7 · §9.6 (durum kolonları olayla aynı tx).
-- İDEMPOTENT ([DB-23]); GÜVENLİ: yalnız EKLEME + kind_ck yeniden tanımı (mevcut 6 tür kalır).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "WarpBeamMountMethod" AS ENUM ('TYING_IN', 'DRAWING_IN', 'HARNESS_CHANGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "WarpLengthSource" AS ENUM ('LOOM_COUNTER', 'DIAMETER', 'WEIGHED', 'ESTIMATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── İstasyon yeteneği: levent TÜKETİR (dokuma tezgahı / raşel) — varsayılan false = bugün ─────
ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "consumesWarpBeam" boolean NOT NULL DEFAULT false;

-- ── WarpBeam "şu an nerede" ─────────────────────────────────────────────────────────────────
ALTER TABLE "warp_beams" ADD COLUMN IF NOT EXISTS "currentMachineId" uuid;
ALTER TABLE "warp_beams" ADD COLUMN IF NOT EXISTS "currentPosition" smallint;
CREATE INDEX IF NOT EXISTS "warp_beams_currentMachineId_idx" ON "warp_beams" ("currentMachineId");
DO $$ BEGIN
  ALTER TABLE "warp_beams"
    ADD CONSTRAINT "warp_beams_currentMachineId_fkey" FOREIGN KEY ("currentMachineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- MOUNTED ⇔ makine + yuva dolu (durum ↔ konum iki yönlü; çift yüklem kuralı).
DO $$ BEGIN
  ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_mounted_ck" CHECK (
    ("status" = 'MOUNTED') = ("currentMachineId" IS NOT NULL AND "currentPosition" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- YUVA SEDDİ: bir makinede bir yuvada tek bağlı levent (emsal `work_sessions_active_machine_uq`).
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beams_machine_position_uq"
  ON "warp_beams" ("currentMachineId", "currentPosition") WHERE "status" = 'MOUNTED';
-- Gövde seddi: bağlı levent de gövdeyi işgal eder.
DROP INDEX IF EXISTS "warp_beams_physical_live_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beams_physical_live_uq"
  ON "warp_beams" (public.tr_fold("physicalBeamNo"))
  WHERE "status" IN ('READY', 'SHIPPED_OUT', 'MOUNTED') AND "physicalBeamNo" IS NOT NULL;

-- ── Olay kolonları (yalnız ilgili türde dolu) ───────────────────────────────────────────────
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "mountPosition"  smallint;
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "beamRole"       varchar(32);
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "mountMethod"    "WarpBeamMountMethod";
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "setupStartedAt" timestamptz;
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "setupMinutes"   integer;
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "machineCounter" numeric(12,3);
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "lengthSource"   "WarpLengthSource";
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "grossKg"        numeric(14,3);
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "tareKg"         numeric(14,3);
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "fabricLengthM"  numeric(12,3);
CREATE INDEX IF NOT EXISTS "warp_beam_events_beamId_kind_createdAt_idx" ON "warp_beam_events" ("beamId", "kind", "createdAt");

-- Tür listesi `constants/warp-beam.ts` WARP_BEAM_EVENT_KINDS ile BİREBİR (bekçi SON tanımı okur, iki yönlü).
ALTER TABLE "warp_beam_events" DROP CONSTRAINT IF EXISTS "warp_beam_events_kind_ck";
ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_kind_ck" CHECK ("kind" IN (
  'WOUND', 'WOUND_CANCEL', 'SHIP_OUT', 'SHIP_OUT_CANCEL', 'RETURNED_IN', 'RETURNED_IN_CANCEL',
  'MOUNTED', 'MOUNT_CANCEL', 'DISMOUNTED', 'DISMOUNT_CANCEL', 'CONSUMED', 'CONSUMED_CANCEL',
  'ADJUST_IN', 'ADJUST_OUT', 'EXHAUSTED', 'EXHAUST_CANCEL', 'SCRAPPED', 'SCRAP_CANCEL'
));
-- MOUNTED ⇒ makine + yuva dolu (yöntem yalnız `devere.mountTrackingRequired` açıkken zorunlu — servis).
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_mounted_ck" CHECK (
    "kind" <> 'MOUNTED' OR ("machineId" IS NOT NULL AND "mountPosition" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Yuva pozitif; süre negatif olamaz.
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_mount_position_positive" CHECK (
    "mountPosition" IS NULL OR "mountPosition" > 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_setup_minutes_nonneg" CHECK (
    "setupMinutes" IS NULL OR "setupMinutes" >= 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
