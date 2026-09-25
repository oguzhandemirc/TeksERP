-- =============================================================================
-- D3 — İş emri kapanış künyesi (docs/design/IS-EMRI-HAREKET-DEFTERI.md §5)
-- =============================================================================
-- "Üretilen Nihai Toplar" bugün CANLI hesaplanıyor (statü süzgeci, bugünkü kalite
-- kovası, aşım bump'ı) ve iş emri bittiği ANDAKİ hâl hiçbir yerde durmuyor. Künye
-- kapanış tx'inde donar; yeniden açılma onu silmez, sonraki kapanış yeni sürüm yazar.
--
-- GÜVENLİ / ADDITIVE: iki YENİ tablo + dört CHECK + iki trigger. Mevcut tabloya ve
-- satıra dokunulmaz; geçmiş iş emirlerinin YAKLAŞIK künyesi ayrı, kuru-koşumlu
-- backfill script'iyle (kullanıcı kararı S5) — bu migration satır ÜRETMEZ.
-- ⚠️ Trigger fonksiyonu `defter_block_tamper()` burada TANIMLANMAZ (K-A3'te doğar).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "work_order_close_snapshots" (
  "id"               UUID NOT NULL,
  "workOrderId"      UUID NOT NULL,
  "version"          INTEGER NOT NULL,
  "closeKind"        VARCHAR(20) NOT NULL,
  "trigger"          VARCHAR(40) NOT NULL,
  "closedById"       UUID,
  "rollCount"        INTEGER NOT NULL,
  "warehouseM"       DECIMAL(14,3) NOT NULL,
  "a1M"              DECIMAL(14,3) NOT NULL,
  "scrapM"           DECIMAL(14,3) NOT NULL,
  "outputM"          DECIMAL(14,3) NOT NULL,
  "totalKg"          DECIMAL(14,3),
  "weighedRollCount" INTEGER NOT NULL,
  "inputRollCount"   INTEGER NOT NULL,
  "inputM"           DECIMAL(14,3) NOT NULL,
  "yieldPct"         DECIMAL(9,3),
  "shrinkagePct"     DECIMAL(9,3),
  "scrapPct"         DECIMAL(9,3),
  "startedAt"        TIMESTAMPTZ,
  "durationSec"      INTEGER,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_close_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "work_order_close_snapshots_workOrderId_version_key"
  ON "work_order_close_snapshots" ("workOrderId", "version");

CREATE TABLE IF NOT EXISTS "work_order_close_snapshot_lines" (
  "id"           UUID NOT NULL,
  "snapshotId"   UUID NOT NULL,
  "rollId"       UUID NOT NULL,
  "barcode"      VARCHAR(64),
  "producedQtyM" DECIMAL(12,3) NOT NULL,
  "qtyM"         DECIMAL(12,3) NOT NULL,
  "weightKg"     DECIMAL(12,3),
  "width"        DECIMAL(12,3),
  "colorId"      UUID,
  "colorLabel"   VARCHAR(200),
  "qualityGrade" VARCHAR(32),
  "bucket"       VARCHAR(16) NOT NULL,
  "batchId"      UUID,
  "batchLabel"   VARCHAR(64),
  "status"       VARCHAR(32) NOT NULL,
  "foldType"     VARCHAR(64),
  "itemLabel"    VARCHAR(200),
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_close_snapshot_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_order_close_snapshot_lines_snapshotId_idx"
  ON "work_order_close_snapshot_lines" ("snapshotId");
CREATE INDEX IF NOT EXISTS "work_order_close_snapshot_lines_rollId_idx"
  ON "work_order_close_snapshot_lines" ("rollId");

DO $$ BEGIN
  ALTER TABLE "work_order_close_snapshots" ADD CONSTRAINT "work_order_close_snapshots_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_close_snapshot_lines" ADD CONSTRAINT "work_order_close_snapshot_lines_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "work_order_close_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DB seddi (şema-dışı → scripts/test_db_invariants.ts envanterinde)
DO $$ BEGIN
  ALTER TABLE "work_order_close_snapshots" ADD CONSTRAINT "work_order_close_snapshots_close_kind_known"
    CHECK ("closeKind" IN ('AUTO_LAST_STEP', 'MANUAL', 'BACKFILL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_close_snapshots" ADD CONSTRAINT "work_order_close_snapshots_version_pos"
    CHECK ("version" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_close_snapshots" ADD CONSTRAINT "work_order_close_snapshots_output_sum"
    CHECK ("outputM" = "warehouseM" + "a1M" + "scrapM");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_close_snapshot_lines" ADD CONSTRAINT "work_order_close_snapshot_lines_bucket_known"
    CHECK ("bucket" IN ('WAREHOUSE', 'A1', 'SCRAP'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only mühür: UPDATE her zaman, doğrudan DELETE reddedilir; iş emrinden
-- gelen kaskat silme (pg_trigger_depth() > 0) geçer.
DROP TRIGGER IF EXISTS "work_order_close_snapshots_block_tamper" ON "work_order_close_snapshots";
CREATE TRIGGER "work_order_close_snapshots_block_tamper"
  BEFORE UPDATE OR DELETE ON "work_order_close_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"();
DROP TRIGGER IF EXISTS "work_order_close_snapshot_lines_block_tamper" ON "work_order_close_snapshot_lines";
CREATE TRIGGER "work_order_close_snapshot_lines_block_tamper"
  BEFORE UPDATE OR DELETE ON "work_order_close_snapshot_lines"
  FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"();
