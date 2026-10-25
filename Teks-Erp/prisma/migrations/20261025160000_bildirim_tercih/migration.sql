-- =============================================================================
-- Bildirim tercih katmanı F4 (N4-SEMA, `docs/design/BILDIRIM-SISTEMI-PLAN.md` §3.3) — yedi yeni tablo
-- =============================================================================
-- Ne yapar: kişisel sapma (`notification_preferences`), kişisel ayar (`notification_user_settings`),
-- yönetici profilleri (`notification_profiles` + hücre/üye pivotları), tür başına fabrika varsayılanı
-- (`notification_factory_defaults`) ve kayıt takibi (`record_follows`) tablolarını açar.
-- ADDITIVE: yalnız yeni tablolar; mevcut tabloya dokunulmaz, backfill YOK → eski kod yeni şemayla aynen
-- çalışır. Okuyan/yazan kod N4-MOTOR'da (N3 `UserPreference.bildirim.masaustuTurler` taşıması dahil).
-- Kapalı kümeler VarChar + CHECK (TS aynası `src/constants/notification-preference.ts`); `kind` CHECK'siz.
-- `record_follows`: tam olarak bir hedef FK (num_nonnulls) + hedef başına üç partial unique.
-- İdempotent: IF NOT EXISTS + duplicate_object yoklaması. Yeni tablo → yumuşak kapı gerekmez.
-- =============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "scope" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_user_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "quietStart" VARCHAR(5),
    "quietEnd" VARCHAR(5),
    "quietChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "digestHour" SMALLINT,
    "sound" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_profiles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "archivedAt" TIMESTAMPTZ,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_profile_cells" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_profile_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_profile_members" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_profile_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_factory_defaults" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "params" JSONB,
    "extraRecipientIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_factory_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "record_follows" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderId" UUID,
    "workOrderId" UUID,
    "weavingOrderId" UUID,
    "state" VARCHAR(16) NOT NULL DEFAULT 'TAKIP',
    "reason" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "record_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_userId_kind_channel_key" ON "notification_preferences"("userId", "kind", "channel");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_user_settings_userId_key" ON "notification_user_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_profiles_code_key" ON "notification_profiles"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_profiles_clientToken_key" ON "notification_profiles"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_profile_cells_profileId_kind_key" ON "notification_profile_cells"("profileId", "kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notification_profile_members_userId_idx" ON "notification_profile_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_profile_members_profileId_userId_key" ON "notification_profile_members"("profileId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_factory_defaults_kind_key" ON "notification_factory_defaults"("kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "record_follows_orderId_idx" ON "record_follows"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "record_follows_workOrderId_idx" ON "record_follows"("workOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "record_follows_weavingOrderId_idx" ON "record_follows"("weavingOrderId");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "notification_user_settings" ADD CONSTRAINT "notification_user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "notification_profile_cells" ADD CONSTRAINT "notification_profile_cells_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "notification_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "notification_profile_members" ADD CONSTRAINT "notification_profile_members_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "notification_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "notification_profile_members" ADD CONSTRAINT "notification_profile_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_weavingOrderId_fkey" FOREIGN KEY ("weavingOrderId") REFERENCES "weaving_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Partial unique: kişi × kayıt başına tek takip satırı (Prisma ifade edemez → `test_db_invariants`).
CREATE UNIQUE INDEX IF NOT EXISTS "record_follows_user_order_uq"
    ON "record_follows"("userId", "orderId") WHERE "orderId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "record_follows_user_work_order_uq"
    ON "record_follows"("userId", "workOrderId") WHERE "workOrderId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "record_follows_user_weaving_order_uq"
    ON "record_follows"("userId", "weavingOrderId") WHERE "weavingOrderId" IS NOT NULL;

-- CHECK'ler (kapalı kümeler; biçim; çift yüklem).
DO $$ BEGIN ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_channel_ck" CHECK ("channel" IN ('UYGULAMA', 'OZET', 'MASAUSTU', 'TABLET_SES', 'PATRON_PUSH')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_user_settings" ADD CONSTRAINT "notification_user_settings_quiet_format_ck" CHECK (("quietStart" IS NULL OR "quietStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND ("quietEnd" IS NULL OR "quietEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_user_settings" ADD CONSTRAINT "notification_user_settings_quiet_pair_ck" CHECK (("quietStart" IS NULL) = ("quietEnd" IS NULL)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_user_settings" ADD CONSTRAINT "notification_user_settings_quiet_channels_ck" CHECK ("quietChannels" <@ ARRAY['MASAUSTU', 'TABLET_SES', 'PATRON_PUSH']::TEXT[]); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_user_settings" ADD CONSTRAINT "notification_user_settings_digest_hour_ck" CHECK ("digestHour" IS NULL OR "digestHour" BETWEEN 0 AND 23); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_profile_cells" ADD CONSTRAINT "notification_profile_cells_state_ck" CHECK ("state" IN ('ACIK', 'KAPALI', 'KILITLI')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notification_factory_defaults" ADD CONSTRAINT "notification_factory_defaults_state_ck" CHECK ("state" IN ('MIRAS', 'ACIK', 'KAPALI', 'KILITLI')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_one_target_ck" CHECK (num_nonnulls("orderId", "workOrderId", "weavingOrderId") = 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_state_ck" CHECK ("state" IN ('TAKIP', 'BIRAKTI')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_reason_ck" CHECK ("reason" IN ('OLUSTURAN', 'ELLE')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
