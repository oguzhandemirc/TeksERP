-- =============================================================================
-- LEVENT (WarpBeam) — devere Faz 1b · c2b (2026-09-14; 125000 idempotent değildi, yeniden adlandırıldı — inmemişti): 3 enum + 2 tablo + iplik defteri bağı
-- =============================================================================
-- Tasarım: docs/design/DEVERE-LEVENT-TARAMASI.md §4.3 · §4.4 · §4.6. Tamamen EKLEMELİ.
-- ⚠️ Yeni TİPLER burada DOĞUYOR (`CREATE TYPE`) ⇒ aynı dosyada kullanılabilir (55P04 yalnız
--   `ADD VALUE`a özgüdür — RECETELER § enum). YarnMovementKind/ReasonPresetKind değerleri c1'de
--   kendi dosyalarında doğdu; burada yalnız CHECK ile ANILIR.
-- ⚠️ Faz 3 kolonları (currentMachineId · currentPosition · yuva seddi) BU DOSYADA YOK.
-- ⚠️ İDEMPOTENT ([DB-23], RECETELER migration 11): `apply-migration.ts` defterde satır olsa da SQL'i yeniden
--   koşar — her ifade ikinci koşumda sessiz geçer (IF NOT EXISTS / DO-EXCEPTION duplicate_object). İkinci
--   koşum sondası: defter satırı silinip `migrate deploy` dolu DB'de yeniden koşturuldu (2026-09-14, 47 K1).

DO $$ BEGIN
  CREATE TYPE "WarpBeamStatus" AS ENUM ('PLANNED', 'READY', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "WarpBeamOrigin" AS ENUM ('IN_HOUSE', 'SUBCONTRACT', 'PURCHASED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "WarpKgSource" AS ENUM ('WEIGHED', 'THEORETICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "warp_beams" (
  "id"              uuid             NOT NULL,
  "beamNo"          varchar(32)      NOT NULL,
  "clientToken"     uuid,
  "warpSpecId"      uuid             NOT NULL,
  "status"          "WarpBeamStatus" NOT NULL DEFAULT 'PLANNED',
  "plannedLengthM"  numeric(12,3)    NOT NULL,
  "physicalBeamNo"  varchar(32),
  "notes"           varchar(500),
  "originKind"      "WarpBeamOrigin" NOT NULL DEFAULT 'IN_HOUSE',
  "subcontractorId" uuid,
  "supplierId"      uuid,
  "createdAt"       timestamptz      NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz      NOT NULL,
  "createdById"     uuid,
  "updatedById"     uuid,
  CONSTRAINT "warp_beams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warp_beams_beamNo_key"      ON "warp_beams" ("beamNo");
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beams_clientToken_key" ON "warp_beams" ("clientToken");
CREATE INDEX IF NOT EXISTS "warp_beams_status_warpSpecId_idx" ON "warp_beams" ("status", "warpSpecId");
CREATE INDEX IF NOT EXISTS "warp_beams_warpSpecId_idx"        ON "warp_beams" ("warpSpecId");
CREATE INDEX IF NOT EXISTS "warp_beams_subcontractorId_idx"   ON "warp_beams" ("subcontractorId");
CREATE INDEX IF NOT EXISTS "warp_beams_supplierId_idx"        ON "warp_beams" ("supplierId");

DO $$ BEGIN
  ALTER TABLE "warp_beams"
    ADD CONSTRAINT "warp_beams_warpSpecId_fkey"      FOREIGN KEY ("warpSpecId")      REFERENCES "warp_specs"("id")     ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "warp_beams"
    ADD CONSTRAINT "warp_beams_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "warp_beams"
    ADD CONSTRAINT "warp_beams_supplierId_fkey"      FOREIGN KEY ("supplierId")      REFERENCES "customers"("id")      ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Plan metresi pozitif.
DO $$ BEGIN
  ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_planned_length_positive" CHECK ("plannedLengthM" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- KÖKEN XOR'u — İKİNCİ HAT (birincil doğrulama servis `resolveOriginParty`, Türkçe mesaj orada):
--   IN_HOUSE ⇒ ikisi de NULL · SUBCONTRACT ⇒ yalnız subcontractorId · PURCHASED ⇒ TAM BİRİ.
DO $$ BEGIN
  ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_origin_party_ck" CHECK (
  ("originKind" = 'IN_HOUSE'    AND "subcontractorId" IS NULL     AND "supplierId" IS NULL) OR
  ("originKind" = 'SUBCONTRACT' AND "subcontractorId" IS NOT NULL AND "supplierId" IS NULL) OR
  ("originKind" = 'PURCHASED'   AND (("subcontractorId" IS NULL) <> ("supplierId" IS NULL)))
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bir gövdede iki CANLI çözgü olmaz (READY; MOUNTED Faz 3'te bu yükleme eklenir).
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beams_physical_live_uq"
  ON "warp_beams" (public.tr_fold("physicalBeamNo"))
  WHERE "status" IN ('READY') AND "physicalBeamNo" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "warp_beam_events" (
  "id"              uuid             NOT NULL,
  "beamId"          uuid             NOT NULL,
  "kind"            varchar(32)      NOT NULL,
  "clientToken"     uuid,
  "reversesEventId" uuid,
  "fromStatus"      "WarpBeamStatus" NOT NULL,
  "toStatus"        "WarpBeamStatus" NOT NULL,
  "lengthM"         numeric(12,3),
  "machineId"       uuid,
  "endsCount"       integer,
  "denier"          numeric(10,4),
  "theoreticalKg"   numeric(14,3),
  "kgSource"        "WarpKgSource",
  "sectionCount"    integer,
  "endsPerSection"  integer,
  "breakCount"      integer,
  "startedAt"       timestamptz,
  "reasonCode"      varchar(64),
  "reason"          varchar(300),
  "createdById"     uuid,
  "createdAt"       timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT "warp_beam_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warp_beam_events_clientToken_key"     ON "warp_beam_events" ("clientToken");
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beam_events_reversesEventId_key" ON "warp_beam_events" ("reversesEventId");
CREATE INDEX IF NOT EXISTS "warp_beam_events_beamId_createdAt_idx"    ON "warp_beam_events" ("beamId", "createdAt");
CREATE INDEX IF NOT EXISTS "warp_beam_events_machineId_createdAt_idx" ON "warp_beam_events" ("machineId", "createdAt");
CREATE INDEX IF NOT EXISTS "warp_beam_events_kind_createdAt_idx"      ON "warp_beam_events" ("kind", "createdAt");

DO $$ BEGIN
  ALTER TABLE "warp_beam_events"
    ADD CONSTRAINT "warp_beam_events_beamId_fkey"          FOREIGN KEY ("beamId")          REFERENCES "warp_beams"("id")       ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "warp_beam_events"
    ADD CONSTRAINT "warp_beam_events_reversesEventId_fkey" FOREIGN KEY ("reversesEventId") REFERENCES "warp_beam_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "warp_beam_events"
    ADD CONSTRAINT "warp_beam_events_machineId_fkey"       FOREIGN KEY ("machineId")       REFERENCES "machines"("id")         ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tür listesi `constants/warp-beam.ts` WARP_BEAM_EVENT_KINDS ile BİREBİR (bekçi iki yönlü ölçer); Faz 3 genişletir.
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_kind_ck" CHECK ("kind" IN ('WOUND', 'WOUND_CANCEL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_length_positive" CHECK ("lengthM" IS NULL OR "lengthM" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- TEK YÖNLÜ: `_CANCEL` ⇒ bağ dolu (karşı ADJUST da bağ taşır, çift yön yazılamaz).
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_cancel_link_ck" CHECK ("kind" NOT LIKE '%\_CANCEL' OR "reversesEventId" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- WOUND gerçekleri — `machineId` BU LİSTEDE DEĞİL (makine zorunluluğu kökene bağlı, servis + bekçi).
DO $$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_wound_facts_ck" CHECK (
  "kind" <> 'WOUND' OR ("lengthM" IS NOT NULL AND "endsCount" IS NOT NULL AND "denier" IS NOT NULL AND "theoreticalKg" IS NOT NULL AND "kgSource" IS NOT NULL)
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Bir levent bir kez doğar; iptal edilen yeniden sarılmaz, YENİ levent açılır (yüklem "aktif" taşımaz).
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beam_events_one_wound_uq" ON "warp_beam_events" ("beamId") WHERE "kind" = 'WOUND';

-- İplik defteri bağı: WARP_* satırı ⇔ levent bağı; dip iadesinde sebep ZORUNLU (§3.7).
ALTER TABLE "yarn_movements" ADD COLUMN IF NOT EXISTS "warpBeamId" uuid;
ALTER TABLE "yarn_movements" ADD COLUMN IF NOT EXISTS "reasonCode" varchar(64);
CREATE INDEX IF NOT EXISTS "yarn_movements_warpBeamId_idx" ON "yarn_movements" ("warpBeamId");
DO $$ BEGIN
  ALTER TABLE "yarn_movements"
    ADD CONSTRAINT "yarn_movements_warpBeamId_fkey" FOREIGN KEY ("warpBeamId") REFERENCES "warp_beams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_warp_link_ck" CHECK (
  ("kind" IN ('WARP_ISSUE', 'WARP_ISSUE_REVERSAL', 'WARP_RETURN', 'WARP_RETURN_REVERSAL')) = ("warpBeamId" IS NOT NULL)
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_warp_return_reason_ck" CHECK (
  "kind" NOT IN ('WARP_RETURN', 'WARP_RETURN_REVERSAL') OR "reasonCode" IS NOT NULL
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
