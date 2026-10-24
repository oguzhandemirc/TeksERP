-- =============================================================================
-- Bildirim çekirdeği F1 (N1-SEMA, `docs/design/BILDIRIM-SISTEMI-PLAN.md` §3.2) — dört yeni tablo
-- =============================================================================
-- ADDITIVE: yalnız yeni tablolar (outbox · gelen kutusu · koşul · günlük sayaç); mevcut tabloya
-- dokunulmaz, backfill YOK → eski kod yeni şemayla aynen çalışır. Yazan/okuyan kod N1-MOTOR'da.
-- Dört tablo da TELEMETRİ/DURUM'dur (budanır, defter değil). `kind` CHECK'siz: yeni tür migration
-- istemesin (tek kaynak katalog + bekçi). Polimorfik `subjectId`/`conditionId`/`lastOutboxId`/
-- `actorUserId` FK'sız. Tekillikler partial unique (Prisma ifade edemez → `test_db_invariants`).
-- İdempotent: IF NOT EXISTS + duplicate_object yoklaması. Yeni tablo → yumuşak kapı gerekmez.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "notification_outbox" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "phase" VARCHAR(16) NOT NULL,
    "subjectType" VARCHAR(32) NOT NULL,
    "subjectId" UUID,
    "subjectKey" VARCHAR(160) NOT NULL,
    "conditionId" UUID,
    "actorUserId" UUID,
    "payload" JSONB NOT NULL,
    "dedupeKey" VARCHAR(200) NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMPTZ,
    "processedAt" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(64),
    "recipientCount" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_inbox" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "klass" VARCHAR(16) NOT NULL,
    "subjectType" VARCHAR(32) NOT NULL,
    "subjectId" UUID,
    "groupKey" VARCHAR(200) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMPTZ NOT NULL,
    "lastAt" TIMESTAMPTZ NOT NULL,
    "lastOutboxId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" VARCHAR(16) NOT NULL,
    "kanalMasaustu" BOOLEAN NOT NULL DEFAULT false,
    "kanalTablet" BOOLEAN NOT NULL DEFAULT false,
    "ozet" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ,
    "snoozedUntil" TIMESTAMPTZ,
    "resolvedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_inbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_conditions" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "subjectKey" VARCHAR(160) NOT NULL,
    "subjectType" VARCHAR(32) NOT NULL,
    "subjectId" UUID,
    "openedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_conditions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_daily_stats" (
    "id" UUID NOT NULL,
    "factoryDay" DATE NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "events" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_daily_stats_pkey" PRIMARY KEY ("id")
);

-- Şemadaki indeksler (Prisma ad kalıbı)
CREATE INDEX IF NOT EXISTS "notification_inbox_userId_lastAt_idx" ON "notification_inbox"("userId", "lastAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_daily_stats_factoryDay_kind_key" ON "notification_daily_stats"("factoryDay", "kind");

-- ŞEMA-DIŞI: partial unique / partial index
-- Açık (çözülmemiş) satırda kişi × konu tek: dağıtıcının `ON CONFLICT … WHERE "resolvedAt" IS NULL` birleştirme hedefi.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_inbox_open_group_uq"
    ON "notification_inbox"("userId", "groupKey") WHERE "resolvedAt" IS NULL;
-- Açık koşul tür × konu başına tek: tarayıcının `ON CONFLICT DO NOTHING` açma seddi (çift ACILDI yok).
CREATE UNIQUE INDEX IF NOT EXISTS "notification_conditions_open_uq"
    ON "notification_conditions"("kind", "subjectKey") WHERE "resolvedAt" IS NULL;
-- Dağıtıcı süpürmesi yalnız işlenmemiş kuyruğu tarar (işlenmiş satırlar indekse girmez).
CREATE INDEX IF NOT EXISTS "notification_outbox_pending_idx"
    ON "notification_outbox"("createdAt") WHERE "processedAt" IS NULL;

-- FK: yalnız gelen kutusu → users (kullanıcı soft delete olur → RESTRICT)
DO $$ BEGIN ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ŞEMA-DIŞI: CHECK'ler (kapalı kümeler VarChar + CHECK; `kind` bilinçli olarak CHECK'siz)
DO $$ BEGIN ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_phase_ck" CHECK ("phase" IN ('OLAY', 'ACILDI', 'KAPANDI', 'GUNCELLENDI')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_attempts_ck" CHECK ("attempts" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_klass_ck" CHECK ("klass" IN ('ALARM', 'BILDIRIM')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_reason_ck" CHECK ("reason" IN ('IZIN', 'TAKIPCI', 'OLUSTURAN', 'NOBET', 'LISTE', 'ALARM_ALICISI')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_count_ck" CHECK ("count" >= 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_daily_stats" ADD CONSTRAINT "notification_daily_stats_events_ck" CHECK ("events" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
