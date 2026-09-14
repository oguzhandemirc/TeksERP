-- =============================================================================
-- VARDİYA KARNESİ — dokuma raporları Dilim 1 (2026-09-14, 01): 2 enum + 3 tablo + 1 ham unique
-- =============================================================================
-- Tasarım: docs/design/DOKUMA-RAPOR-BACKEND-TASARIM-OZETI.md §2 (1e hükmü §1: tanecik
--   makine×vardiya, `productionLineNo` unique'te YOK — hat kırılımı gerekirse eklemeli
--   çocuk tablo). Kaynak belge DOKUMA-TEZGAH-IZLEME-TASARIMI.md §2.10 / §2.11.
-- ADDITIVE: var olan hiçbir tabloya/kolona DOKUNMAZ; üçü de BOŞ doğar. Referans
--   profilde (`dokuma.enabled=false`) yazan job "disabled" döner, tablo boş kalır.
-- ⚠️ `CREATE TYPE` onu kullanan `CREATE TABLE` ile aynı dosyada — doğrudur (55P04
--   yalnız `ADD VALUE`a özgü; RECETELER § enum).
-- ⚠️ İDEMPOTENT ([DB-23], RECETELER migration 11): her ifade ikinci koşumda sessiz geçer
--   (IF NOT EXISTS / DO-EXCEPTION duplicate_object). Katalog satırı DOĞURMAZ (seed çakışması yok).
-- ⚠️ `statement_timeout = 0` GEREKMİYOR: üç tablo da boş doğuyor.

DO $$ BEGIN
  CREATE TYPE "MachineSealState" AS ENUM ('OPEN', 'SEALED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "MachineSealAction" AS ENUM ('SEAL', 'UNSEAL', 'RESEAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── KARNE (DURUM; `updatedAt` VAR — geçmişi seal defteri taşır) ─────────────
CREATE TABLE IF NOT EXISTS "machine_shift_stats" (
  "id"                    UUID                     NOT NULL,
  "machineId"             UUID                     NOT NULL,
  "shiftInstanceId"       UUID                     NOT NULL,
  "factoryDay"            DATE                     NOT NULL,
  "calendarSec"           INTEGER                  NOT NULL DEFAULT 0,
  "unobservedSec"         INTEGER                  NOT NULL DEFAULT 0,
  "nonScheduledSec"       INTEGER                  NOT NULL DEFAULT 0,
  "plannedBreakSec"       INTEGER                  NOT NULL DEFAULT 0,
  "potSec"                INTEGER                  NOT NULL DEFAULT 0,
  "aptSec"                INTEGER                  NOT NULL DEFAULT 0,
  "setupSec"              INTEGER                  NOT NULL DEFAULT 0,
  "plannedDownSec"        INTEGER                  NOT NULL DEFAULT 0,
  "unplannedDownSec"      INTEGER                  NOT NULL DEFAULT 0,
  "minorStopSec"          INTEGER                  NOT NULL DEFAULT 0,
  "minorStopCount"        INTEGER                  NOT NULL DEFAULT 0,
  "stopCount"             INTEGER                  NOT NULL DEFAULT 0,
  "warpStopCount"         INTEGER,
  "weftStopCount"         INTEGER,
  "unclassifiedSec"       INTEGER                  NOT NULL DEFAULT 0,
  "picksActual"           INTEGER                  NOT NULL DEFAULT 0,
  "gapPicks"              INTEGER                  NOT NULL DEFAULT 0,
  "watchdogSec"           INTEGER                  NOT NULL DEFAULT 0,
  "targetPickCapacityApt" INTEGER                  NOT NULL DEFAULT 0,
  "targetPickCapacityPot" INTEGER                  NOT NULL DEFAULT 0,
  "targetPicksPerMin"     INTEGER,
  "stopThresholdSec"      INTEGER                  NOT NULL,
  "unitsPerCmAtClose"     NUMERIC(8,3),
  "producedM"             NUMERIC(12,3),
  "availabilityPct"       NUMERIC(5,2),
  "performancePct"        NUMERIC(5,2),
  "effectivenessPct"      NUMERIC(5,2),
  "formulaVersion"        INTEGER,
  "source"                "MachineDataSource"      NOT NULL,
  "monitoringState"       "MachineMonitoringState" NOT NULL,
  "anomalyAck"            BOOLEAN                  NOT NULL DEFAULT false,
  "sealState"             "MachineSealState"       NOT NULL DEFAULT 'OPEN',
  "sealGeneration"        INTEGER                  NOT NULL DEFAULT 0,
  "sealedAt"              TIMESTAMPTZ,
  "sealedById"            UUID,
  "createdAt"             TIMESTAMPTZ              NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ              NOT NULL,
  CONSTRAINT "machine_shift_stats_pkey" PRIMARY KEY ("id")
);

-- Terimler saniye/atkı sayacıdır, negatif olamaz; eşik pozitif (0 eşik "her duruş mikro"
-- demek olurdu). Mühürlü satırın kuşağı ≥ 1 ve damgası dolu: SEALED ∧ sealGeneration=0
-- ya da SEALED ∧ sealedAt NULL, claim atlanarak yazılmış bir satırın imzasıdır.
DO $$ BEGIN
  ALTER TABLE "machine_shift_stats" ADD CONSTRAINT "machine_shift_stats_terms_nonneg" CHECK (
    "calendarSec" >= 0 AND "unobservedSec" >= 0 AND "nonScheduledSec" >= 0 AND "plannedBreakSec" >= 0
    AND "potSec" >= 0 AND "aptSec" >= 0 AND "setupSec" >= 0 AND "plannedDownSec" >= 0
    AND "unplannedDownSec" >= 0 AND "minorStopSec" >= 0 AND "minorStopCount" >= 0 AND "stopCount" >= 0
    AND ("warpStopCount" IS NULL OR "warpStopCount" >= 0) AND ("weftStopCount" IS NULL OR "weftStopCount" >= 0)
    AND "unclassifiedSec" >= 0 AND "picksActual" >= 0 AND "gapPicks" >= 0 AND "watchdogSec" >= 0
    AND "targetPickCapacityApt" >= 0 AND "targetPickCapacityPot" >= 0 AND "sealGeneration" >= 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "machine_shift_stats" ADD CONSTRAINT "machine_shift_stats_threshold_pos"
    CHECK ("stopThresholdSec" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "machine_shift_stats" ADD CONSTRAINT "machine_shift_stats_seal_ck" CHECK (
    "sealState" = 'OPEN' OR ("sealGeneration" >= 1 AND "sealedAt" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6e sözleşmesi: `assertStopShiftWritableTx` bu unique üstünden `findUnique` okur.
CREATE UNIQUE INDEX IF NOT EXISTS "machine_shift_stats_machineId_shiftInstanceId_key"
  ON "machine_shift_stats" ("machineId", "shiftInstanceId");
CREATE INDEX IF NOT EXISTS "machine_shift_stats_factoryDay_machineId_idx" ON "machine_shift_stats" ("factoryDay", "machineId");
CREATE INDEX IF NOT EXISTS "machine_shift_stats_sealedAt_idx"             ON "machine_shift_stats" ("sealedAt");

DO $$ BEGIN
  ALTER TABLE "machine_shift_stats"
    ADD CONSTRAINT "machine_shift_stats_machineId_fkey"       FOREIGN KEY ("machineId")       REFERENCES "machines"("id")        ON DELETE RESTRICT  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "machine_shift_stats"
    ADD CONSTRAINT "machine_shift_stats_shiftInstanceId_fkey" FOREIGN KEY ("shiftInstanceId") REFERENCES "shift_instances"("id") ON DELETE RESTRICT  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "machine_shift_stats"
    ADD CONSTRAINT "machine_shift_stats_sealedById_fkey"      FOREIGN KEY ("sealedById")      REFERENCES "users"("id")           ON DELETE SET NULL  ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SEBEP KIRILIMI DEFTERİ (append-only, kuşak başına) ──────────────────────
CREATE TABLE IF NOT EXISTS "machine_shift_stop_breakdowns" (
  "id"             UUID                   NOT NULL,
  "statId"         UUID                   NOT NULL,
  "sealGeneration" INTEGER                NOT NULL,
  "reasonCode"     VARCHAR(64),
  "reasonLabel"    VARCHAR(100),
  "lossClass"      "MachineStopLossClass",
  "beamSlotNull"   BOOLEAN                NOT NULL DEFAULT false,
  "stopCount"      INTEGER                NOT NULL,
  "stopSec"        INTEGER                NOT NULL,
  "createdAt"      TIMESTAMPTZ            NOT NULL DEFAULT now(),
  CONSTRAINT "machine_shift_stop_breakdowns_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "machine_shift_stop_breakdowns" ADD CONSTRAINT "machine_shift_stop_breakdowns_nonneg"
    CHECK ("stopCount" >= 0 AND "stopSec" >= 0 AND "sealGeneration" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "machine_shift_stop_breakdowns_statId_sealGeneration_idx" ON "machine_shift_stop_breakdowns" ("statId", "sealGeneration");
CREATE INDEX IF NOT EXISTS "machine_shift_stop_breakdowns_reasonCode_idx"            ON "machine_shift_stop_breakdowns" ("reasonCode");

-- ⚠️ ŞEMA-DIŞI UNIQUE — İFADE İNDEKSİ (`test_db_invariants` EXPRESSION_UNIQUES).
--    Sınıflandırılmamış kova `reasonCode` NULL'dur ve PG'nin varsayılanı NULLS DISTINCT:
--    düz unique aynı kuşakta iki "sınıflandırılmamış" satırı sessizce kabul ederdi.
--    `NULLS NOT DISTINCT` (PG 15+) yerine COALESCE ifadesi seçildi: Prisma ifade
--    indeksini görmez (drift yok), NULLS NOT DISTINCT'li düz unique'i ise "DROP INDEX"
--    diye önerir (ölçüldü 2026-09-14, `test_schema_drift` 1 belgesiz fark).
CREATE UNIQUE INDEX IF NOT EXISTS "machine_shift_stop_breakdowns_uq"
  ON "machine_shift_stop_breakdowns" ("statId", "sealGeneration", COALESCE("reasonCode", ''), "beamSlotNull");

DO $$ BEGIN
  ALTER TABLE "machine_shift_stop_breakdowns"
    ADD CONSTRAINT "machine_shift_stop_breakdowns_statId_fkey" FOREIGN KEY ("statId") REFERENCES "machine_shift_stats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── MÜHÜR DEFTERİ (append-only) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "machine_shift_stat_seals" (
  "id"                    UUID                NOT NULL,
  "statId"                UUID                NOT NULL,
  "action"                "MachineSealAction" NOT NULL,
  "sealGeneration"        INTEGER             NOT NULL,
  "terms"                 JSONB               NOT NULL,
  "potSec"                INTEGER             NOT NULL,
  "aptSec"                INTEGER             NOT NULL,
  "picksActual"           INTEGER             NOT NULL,
  "targetPickCapacityPot" INTEGER             NOT NULL,
  "effectivenessPct"      NUMERIC(5,2),
  "formulaVersion"        INTEGER             NOT NULL,
  "reason"                VARCHAR(300),
  "actedById"             UUID,
  "createdAt"             TIMESTAMPTZ         NOT NULL DEFAULT now(),
  CONSTRAINT "machine_shift_stat_seals_pkey" PRIMARY KEY ("id")
);

-- Doğal anahtar (§2.11): bir kuşakta her eylemden en çok BİR satır.
CREATE UNIQUE INDEX IF NOT EXISTS "machine_shift_stat_seals_statId_sealGeneration_action_key"
  ON "machine_shift_stat_seals" ("statId", "sealGeneration", "action");
CREATE INDEX IF NOT EXISTS "machine_shift_stat_seals_statId_createdAt_idx" ON "machine_shift_stat_seals" ("statId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "machine_shift_stat_seals"
    ADD CONSTRAINT "machine_shift_stat_seals_statId_fkey"    FOREIGN KEY ("statId")    REFERENCES "machine_shift_stats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "machine_shift_stat_seals"
    ADD CONSTRAINT "machine_shift_stat_seals_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "users"("id")               ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
