-- =============================================================================
-- VARDİYA KARNESİ HAT KIRILIMI — `machine_shift_line_stats` (2026-09-15, 01)
-- =============================================================================
-- Tasarım: docs/design/DOKUMA-RAPOR-BACKEND-TASARIM-OZETI.md §1/1 (1e hükmü: karne
--   taneciği makine×vardiya BÖLÜNMEZ; hat kırılımı EKLEMELİ çocuk tablo
--   `MachineShiftLineStat(statId, productionLineNo)`).
-- ADDITIVE: var olan hiçbir tabloya/kolona DOKUNMAZ; tablo BOŞ doğar. Satır yalnız
--   `machines.productionLineCount > 1` makinede yazılır — referans profilde (tüm
--   tezgahlar tek hatlı) tablo boş kalır = bugünkü davranış.
-- ⚠️ İDEMPOTENT ([DB-23], RECETELER migration 11): her ifade ikinci koşumda sessiz geçer
--   (IF NOT EXISTS / DO-EXCEPTION duplicate_object). Katalog satırı DOĞURMAZ.
-- ⚠️ `statement_timeout = 0` GEREKMİYOR: tablo boş doğuyor.

CREATE TABLE IF NOT EXISTS "machine_shift_line_stats" (
  "id"                    UUID         NOT NULL,
  "statId"                UUID         NOT NULL,
  "productionLineNo"      SMALLINT     NOT NULL,
  "runCount"              INTEGER      NOT NULL DEFAULT 0,
  "unitsActual"           INTEGER      NOT NULL DEFAULT 0,
  "targetUnitCapacityApt" INTEGER      NOT NULL DEFAULT 0,
  "targetUnitCapacityPot" INTEGER      NOT NULL DEFAULT 0,
  "targetUnitsPerMin"     INTEGER,
  "unitsPerCmAtClose"     NUMERIC(8,3),
  "producedM"             NUMERIC(12,3),
  "createdAt"             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ  NOT NULL,
  CONSTRAINT "machine_shift_line_stats_pkey" PRIMARY KEY ("id")
);

-- Hat numarası `MachineRun.productionLineNo` emsali (>= 1); sayaçlar negatif olamaz.
DO $$ BEGIN
  ALTER TABLE "machine_shift_line_stats" ADD CONSTRAINT "machine_shift_line_stats_line_pos"
    CHECK ("productionLineNo" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "machine_shift_line_stats" ADD CONSTRAINT "machine_shift_line_stats_nonneg" CHECK (
    "runCount" >= 0 AND "unitsActual" >= 0 AND "targetUnitCapacityApt" >= 0 AND "targetUnitCapacityPot" >= 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bir karnede her hattan en çok BİR satır; upsert bu anahtarla.
CREATE UNIQUE INDEX IF NOT EXISTS "machine_shift_line_stats_statId_productionLineNo_key"
  ON "machine_shift_line_stats" ("statId", "productionLineNo");

DO $$ BEGIN
  ALTER TABLE "machine_shift_line_stats"
    ADD CONSTRAINT "machine_shift_line_stats_statId_fkey" FOREIGN KEY ("statId")
    REFERENCES "machine_shift_stats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
