-- =============================================================================
-- D1 — İş emri hareket defteri (defter doktrini)
-- Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §4, §12
-- =============================================================================
-- Bugün iş emrinin otomatik başlama/tamamlanma/yeniden açılma geçişleri hiçbir
-- yerde (audit dahil) iz bırakmıyor; plan değişiklikleri yalnız audit'te (6 ayda
-- arşivlenir, iş kaynağı olarak okunamaz). `work_order_events` bu geçmişi taşır.
--
-- GÜVENLİ / ADDITIVE: bir YENİ tablo + bir YENİ enum tipi + üç CHECK + bir trigger.
-- Mevcut tabloya ve satıra dokunulmaz. Geriye dönük satır ÜRETİLMEZ — geçmiş,
-- ayrı ve kuru-koşumlu `scripts/backfill_workorder_events.ts` ile doldurulur.
-- ⚠️ Enum YENİ tip (`CREATE TYPE`) — ADD VALUE aynı-tx kısıtı burada geçerli değil.
-- ⚠️ Trigger fonksiyonu `defter_block_tamper()` bu migration'da TANIMLANMAZ; ortak
--    fonksiyon K-A3 migration'ında doğar (bu dosya ondan SONRA koşar).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "WorkOrderEventType" AS ENUM
    ('CREATED', 'STATUS_CHANGED', 'FIELD_CHANGED', 'STEP_PLAN_CHANGED', 'ROLL_ATTRIBUTES_APPLIED', 'BATCH_ADDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "work_order_events" (
  "id"          UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "type"        "WorkOrderEventType" NOT NULL,
  "groupId"     UUID NOT NULL,
  "field"       VARCHAR(40),
  "fromValue"   VARCHAR(1000),
  "toValue"     VARCHAR(1000),
  "fromLabel"   VARCHAR(200),
  "toLabel"     VARCHAR(200),
  "trigger"     VARCHAR(40),
  "channel"     VARCHAR(16) NOT NULL,
  "reason"      VARCHAR(300),
  "reasonCode"  VARCHAR(64),
  "refType"     VARCHAR(40),
  "refId"       UUID,
  "payload"     JSONB,
  "createdById" UUID,
  "deviceId"    VARCHAR(128),
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_order_events_workOrderId_createdAt_idx"
  ON "work_order_events" ("workOrderId", "createdAt");
CREATE INDEX IF NOT EXISTS "work_order_events_type_createdAt_idx"
  ON "work_order_events" ("type", "createdAt");
CREATE INDEX IF NOT EXISTS "work_order_events_groupId_idx"
  ON "work_order_events" ("groupId");

DO $$ BEGIN
  ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DB seddi (şema-dışı → scripts/test_db_invariants.ts envanterinde)
DO $$ BEGIN
  ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_channel_known"
    CHECK ("channel" IN ('PANEL', 'TABLET', 'SYSTEM', 'BACKFILL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_field_required"
    CHECK ("type" = 'CREATED' OR "field" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_birth_has_no_from"
    CHECK ("type" <> 'CREATED' OR "fromValue" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only mühür: UPDATE her zaman, doğrudan DELETE reddedilir; iş emrinden
-- gelen kaskat silme (pg_trigger_depth() > 0) geçer.
DROP TRIGGER IF EXISTS "work_order_events_block_tamper" ON "work_order_events";
CREATE TRIGGER "work_order_events_block_tamper"
  BEFORE UPDATE OR DELETE ON "work_order_events"
  FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"();
