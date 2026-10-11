-- =============================================================================
-- Dokuma ALARM motoru (Faz A1) — `loom_alarms` (DURUM) + `loom_alarm_events` (DEFTER)
-- =============================================================================
-- NE YAPIYOR (ADDITIVE — yalnız yeni tip + yeni tablo; mevcut tabloya kolon/backfill YOK):
--   ① Üç YENİ enum tipi (`LoomAlarmKind` · `LoomAlarmState` · `LoomAlarmEventKind`) —
--      yeni TİP olduğu için tabloyla aynı dosyada (55P04 yalnız ADD VALUE'ya özgü).
--   ② `loom_alarms` — duruş başına en çok BİR alarm (`stopEventId` unique); kademe planı
--      doğuşta donar. CHECK'ler: kademe 1..2 · üstlenen çifti · OPEN⇒üstlenen yok,
--      ACKED⇒üstlenen var · susturma çifti · terminal⇔closedAt · CANCELLED⇔cancelReason ·
--      süreler negatif değil.
--   ③ `loom_alarm_events` — append-only defter; mühür `defter_block_tamper` (UPDATE her
--      zaman, doğrudan DELETE RED; alarmın kaskat silmesi geçer). Partial unique:
--      aynı kademe iki kez doğamaz (RAISED/TIER_SKIPPED). Not geri çekme ayrı satır
--      (NOTE_RETRACT → `retractsEventId`, unique: not başına bir kez).
--      CHECK'ler: tür ↔ kolon biçimi (kademe · kişi · susturma anı · not · geri çekilen · iptal kodu).
-- Davranış bayrağı `tezgah.alarmEnabled` KAPALI (varsayılan) iken tablolara HİÇ satır
-- yazılmaz. İki model de BaseController'dan yazılmaz (tek yazar `loom-alarm.service`).
-- İdempotent: IF NOT EXISTS + duplicate_object yoklaması + DROP TRIGGER IF EXISTS.
-- ⚠️ `defter_block_tamper()` 20260925160000_roll_status_events'te doğar; burada TANIMLANMAZ.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "LoomAlarmKind" AS ENUM ('STOP_OVERDUE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LoomAlarmState" AS ENUM ('OPEN', 'ACKED', 'RESOLVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LoomAlarmEventKind" AS ENUM
    ('RAISED', 'TIER_SKIPPED', 'ACK', 'ACK_RELEASE', 'SNOOZE', 'UNSNOOZE', 'NOTE', 'NOTE_RETRACT', 'RESOLVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "loom_alarms" (
    "id" UUID NOT NULL,
    "kind" "LoomAlarmKind" NOT NULL,
    "stopEventId" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "state" "LoomAlarmState" NOT NULL DEFAULT 'OPEN',
    "tier" INTEGER NOT NULL,
    "targetMinutes" INTEGER,
    "graceMinutes" INTEGER NOT NULL,
    "planReasonCode" VARCHAR(64),
    "k1DueAt" TIMESTAMPTZ NOT NULL,
    "k2DueAt" TIMESTAMPTZ,
    "ackedById" UUID,
    "ackedAt" TIMESTAMPTZ,
    "snoozedUntil" TIMESTAMPTZ,
    "snoozedById" UUID,
    "closedAt" TIMESTAMPTZ,
    "totalSec" INTEGER,
    "overdueSec" INTEGER,
    "cancelReason" VARCHAR(64),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "loom_alarms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "loom_alarm_events" (
    "id" UUID NOT NULL,
    "alarmId" UUID NOT NULL,
    "kind" "LoomAlarmEventKind" NOT NULL,
    "tier" INTEGER,
    "userId" UUID,
    "snoozedUntil" TIMESTAMPTZ,
    "note" VARCHAR(500),
    "code" VARCHAR(64),
    "clientToken" UUID,
    "retractsEventId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loom_alarm_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "loom_alarms_stopEventId_key" ON "loom_alarms"("stopEventId");
CREATE INDEX IF NOT EXISTS "loom_alarms_machineId_createdAt_idx" ON "loom_alarms"("machineId", "createdAt");
CREATE INDEX IF NOT EXISTS "loom_alarms_state_createdAt_idx" ON "loom_alarms"("state", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "loom_alarm_events_clientToken_key" ON "loom_alarm_events"("clientToken");
CREATE UNIQUE INDEX IF NOT EXISTS "loom_alarm_events_retractsEventId_key" ON "loom_alarm_events"("retractsEventId");
CREATE INDEX IF NOT EXISTS "loom_alarm_events_alarmId_createdAt_idx" ON "loom_alarm_events"("alarmId", "createdAt");

-- Aynı kademe iki kez doğamaz — motorun iki eşzamanlı turu ON CONFLICT DO NOTHING ile tek satır bırakır.
CREATE UNIQUE INDEX IF NOT EXISTS "loom_alarm_events_tier_uq"
  ON "loom_alarm_events"("alarmId", "kind", "tier")
  WHERE "kind" IN ('RAISED', 'TIER_SKIPPED');

DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_stopEventId_fkey" FOREIGN KEY ("stopEventId") REFERENCES "machine_stop_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_ackedById_fkey" FOREIGN KEY ("ackedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_snoozedById_fkey" FOREIGN KEY ("snoozedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "loom_alarm_events" ADD CONSTRAINT "loom_alarm_events_alarmId_fkey" FOREIGN KEY ("alarmId") REFERENCES "loom_alarms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "loom_alarm_events" ADD CONSTRAINT "loom_alarm_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- NO ACTION (RESTRICT değil): alarmın kaskat silmesinde not ile geri çekmesi aynı ifadede düşer.
DO $$ BEGIN
  ALTER TABLE "loom_alarm_events" ADD CONSTRAINT "loom_alarm_events_retractsEventId_fkey" FOREIGN KEY ("retractsEventId") REFERENCES "loom_alarm_events"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── loom_alarms CHECK'leri ──────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_tier_ck" CHECK ("tier" BETWEEN 1 AND 2);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_plan_ck" CHECK (
    "graceMinutes" BETWEEN 0 AND 1440
    AND ("targetMinutes" IS NULL OR "targetMinutes" BETWEEN 1 AND 1440)
    AND ("totalSec" IS NULL OR "totalSec" >= 0)
    AND ("overdueSec" IS NULL OR "overdueSec" >= 0)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Üstlenme çifti + durum çift yüklemi: OPEN üstlenilmemiştir, ACKED üstlenilmiştir.
DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_ack_ck" CHECK (
    ("ackedById" IS NULL) = ("ackedAt" IS NULL)
    AND ("state" <> 'OPEN' OR "ackedById" IS NULL)
    AND ("state" <> 'ACKED' OR "ackedById" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_snooze_ck" CHECK (("snoozedUntil" IS NULL) = ("snoozedById" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "loom_alarms" ADD CONSTRAINT "loom_alarms_closed_ck" CHECK (
    ("state" IN ('RESOLVED', 'CANCELLED')) = ("closedAt" IS NOT NULL)
    AND ("state" = 'CANCELLED') = ("cancelReason" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── loom_alarm_events CHECK'leri — tür ↔ kolon biçimi ───────────────────────
DO $$ BEGIN
  ALTER TABLE "loom_alarm_events" ADD CONSTRAINT "loom_alarm_events_shape_ck" CHECK (
    ("kind" IN ('RAISED', 'TIER_SKIPPED')) = ("tier" IS NOT NULL)
    AND ("tier" IS NULL OR "tier" BETWEEN 1 AND 2)
    AND ("kind" IN ('ACK', 'ACK_RELEASE', 'SNOOZE', 'UNSNOOZE', 'NOTE', 'NOTE_RETRACT')) = ("userId" IS NOT NULL)
    AND ("kind" = 'NOTE_RETRACT') = ("retractsEventId" IS NOT NULL)
    AND ("kind" = 'SNOOZE') = ("snoozedUntil" IS NOT NULL)
    AND ("kind" <> 'NOTE' OR "note" IS NOT NULL)
    AND ("kind" = 'CANCELLED') = ("code" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only mühür: UPDATE her zaman, doğrudan DELETE reddedilir; alarmın kaskat silmesi
-- (pg_trigger_depth() > 0) geçer.
DROP TRIGGER IF EXISTS "loom_alarm_events_block_tamper" ON "loom_alarm_events";
CREATE TRIGGER "loom_alarm_events_block_tamper"
  BEFORE UPDATE OR DELETE ON "loom_alarm_events"
  FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"();
