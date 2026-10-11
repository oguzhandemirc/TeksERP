-- =============================================================================
-- Dokuma alarmı A4 — sorumlu ataması (hol × vardiya), nöbet değişikliği, kademe kuralı, donmuş alıcı
-- =============================================================================
-- ADDITIVE: yeni tipler + yeni tablolar + `loom_alarm_events.recipientMode` (nullable; eski satır NULL =
-- izne göre). Backfill YOK. Tanım tabloları silinmez (`revokedAt`); tekillik partial unique ile.
-- `loom_alarm_recipients` append-only (mühür `defter_block_tamper`, alarmın kaskat silmesi geçer).
-- İdempotent: IF NOT EXISTS + duplicate_object yoklaması.
-- =============================================================================

DO $$ BEGIN CREATE TYPE "LoomAlarmRecipientMode" AS ENUM ('BY_PERMISSION', 'LISTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LoomAlarmRecipientSource" AS ENUM ('HALL_SHIFT', 'DUTY_OVERRIDE', 'USER', 'PERMISSION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LoomAlarmRuleRecipientKind" AS ENUM ('HALL_SHIFT', 'USER', 'PERMISSION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "loom_alarm_events" ADD COLUMN IF NOT EXISTS "recipientMode" "LoomAlarmRecipientMode";
DO $$ BEGIN
  ALTER TABLE "loom_alarm_events" ADD CONSTRAINT "loom_alarm_events_recipient_mode_ck" CHECK ("recipientMode" IS NULL OR "kind" = 'RAISED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "loom_alarm_recipients" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" "LoomAlarmRecipientSource" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loom_alarm_recipients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "loom_alarm_recipients_eventId_userId_key" ON "loom_alarm_recipients"("eventId", "userId");
CREATE INDEX IF NOT EXISTS "loom_alarm_recipients_userId_eventId_idx" ON "loom_alarm_recipients"("userId", "eventId");

CREATE TABLE IF NOT EXISTS "hall_shift_responsibles" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "shiftDefinitionId" UUID NOT NULL,
    "tier" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "clientToken" UUID,
    "createdById" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "hall_shift_responsibles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hall_shift_responsibles_clientToken_key" ON "hall_shift_responsibles"("clientToken");
CREATE INDEX IF NOT EXISTS "hall_shift_responsibles_stationId_shiftDefinitionId_idx" ON "hall_shift_responsibles"("stationId", "shiftDefinitionId");
CREATE UNIQUE INDEX IF NOT EXISTS "hall_shift_responsibles_live_uq"
  ON "hall_shift_responsibles"("stationId", "shiftDefinitionId", "tier", "userId") WHERE "revokedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "hall_shift_duty_overrides" (
    "id" UUID NOT NULL,
    "shiftInstanceId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "tier" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "note" VARCHAR(300),
    "clientToken" UUID,
    "createdById" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "hall_shift_duty_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hall_shift_duty_overrides_clientToken_key" ON "hall_shift_duty_overrides"("clientToken");
CREATE INDEX IF NOT EXISTS "hall_shift_duty_overrides_shiftInstanceId_stationId_idx" ON "hall_shift_duty_overrides"("shiftInstanceId", "stationId");
CREATE UNIQUE INDEX IF NOT EXISTS "hall_shift_duty_overrides_live_uq"
  ON "hall_shift_duty_overrides"("shiftInstanceId", "stationId", "tier", "userId") WHERE "revokedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "loom_alarm_tier_rules" (
    "id" UUID NOT NULL,
    "tier" INTEGER NOT NULL,
    "kind" "LoomAlarmRuleRecipientKind" NOT NULL,
    "userId" UUID,
    "permissionCode" VARCHAR(64),
    "clientToken" UUID,
    "createdById" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "loom_alarm_tier_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "loom_alarm_tier_rules_clientToken_key" ON "loom_alarm_tier_rules"("clientToken");
CREATE INDEX IF NOT EXISTS "loom_alarm_tier_rules_tier_idx" ON "loom_alarm_tier_rules"("tier");
CREATE UNIQUE INDEX IF NOT EXISTS "loom_alarm_tier_rules_live_uq"
  ON "loom_alarm_tier_rules"("tier", "kind", "userId", "permissionCode") NULLS NOT DISTINCT WHERE "revokedAt" IS NULL;

-- FK'ler
DO $$ BEGIN ALTER TABLE "loom_alarm_recipients" ADD CONSTRAINT "loom_alarm_recipients_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "loom_alarm_events"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "loom_alarm_recipients" ADD CONSTRAINT "loom_alarm_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "hall_shift_responsibles" ADD CONSTRAINT "hall_shift_responsibles_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "hall_shift_responsibles" ADD CONSTRAINT "hall_shift_responsibles_shiftDefinitionId_fkey" FOREIGN KEY ("shiftDefinitionId") REFERENCES "shift_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "hall_shift_responsibles" ADD CONSTRAINT "hall_shift_responsibles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "hall_shift_duty_overrides" ADD CONSTRAINT "hall_shift_duty_overrides_shiftInstanceId_fkey" FOREIGN KEY ("shiftInstanceId") REFERENCES "shift_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "hall_shift_duty_overrides" ADD CONSTRAINT "hall_shift_duty_overrides_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "hall_shift_duty_overrides" ADD CONSTRAINT "hall_shift_duty_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "loom_alarm_tier_rules" ADD CONSTRAINT "loom_alarm_tier_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CHECK'ler: kademe 1..2 · geri alma çifti · kural biçimi
DO $$ BEGIN ALTER TABLE "hall_shift_responsibles" ADD CONSTRAINT "hall_shift_responsibles_ck" CHECK ("tier" BETWEEN 1 AND 2 AND ("revokedAt" IS NULL) = ("revokedById" IS NULL)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "hall_shift_duty_overrides" ADD CONSTRAINT "hall_shift_duty_overrides_ck" CHECK ("tier" BETWEEN 1 AND 2 AND ("revokedAt" IS NULL) = ("revokedById" IS NULL)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "loom_alarm_tier_rules" ADD CONSTRAINT "loom_alarm_tier_rules_ck" CHECK (
    "tier" BETWEEN 1 AND 2
    AND ("revokedAt" IS NULL) = ("revokedById" IS NULL)
    AND ("kind" = 'USER') = ("userId" IS NOT NULL)
    AND ("kind" = 'PERMISSION') = ("permissionCode" IS NOT NULL)
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Donmuş alıcı append-only: UPDATE her zaman, doğrudan DELETE reddedilir (kaskat geçer).
DROP TRIGGER IF EXISTS "loom_alarm_recipients_block_tamper" ON "loom_alarm_recipients";
CREATE TRIGGER "loom_alarm_recipients_block_tamper"
  BEFORE UPDATE OR DELETE ON "loom_alarm_recipients"
  FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"();
