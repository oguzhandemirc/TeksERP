-- B5 BİLDİRİMLER — kurallar (tesis varsayılanı + hesap tercihi), kuyruk + gönderim kaydı (telemetri).
-- Yalnız EKLER; mevcut tablolara dokunmaz. RLS kalıbı ilk şemayla aynı (tesis yalıtımı, FORCE).

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('BEKLIYOR', 'GONDERILIYOR', 'GONDERILDI', 'BASARISIZ', 'ATLANDI');

-- CreateTable
CREATE TABLE "notification_defaults" (
    "tesis_id" UUID NOT NULL,
    "settings" JSONB NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_defaults_pkey" PRIMARY KEY ("tesis_id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "tesis_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "settings" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tesis_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "dedup_key" VARCHAR(200) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "route" VARCHAR(200),
    "status" "NotificationStatus" NOT NULL DEFAULT 'BEKLIYOR',
    "skip_reason" VARCHAR(40),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL,
    "claim_until" TIMESTAMPTZ,
    "sent_at" TIMESTAMPTZ,
    "last_error" VARCHAR(60),
    "deliveries" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tesis_id_account_id_key" ON "notification_preferences"("tesis_id", "account_id");

-- CreateIndex
CREATE INDEX "notifications_tesis_id_status_next_attempt_at_idx" ON "notifications"("tesis_id", "status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notifications_tesis_id_account_id_created_at_idx" ON "notifications"("tesis_id", "account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tesis_id_account_id_dedup_key_key" ON "notifications"("tesis_id", "account_id", "dedup_key");


-- Çift yüklem seddi: durum ↔ damga/gerekçe kolonu birlikte değişir (yazar tek: src/services/notification-*.ts).
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_gonderildi_damgali"
  CHECK (("status" = 'GONDERILDI') = ("sent_at" IS NOT NULL));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_atlandi_gerekceli"
  CHECK (("status" = 'ATLANDI') = ("skip_reason" IS NOT NULL));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_claim_yalniz_gonderiliyor"
  CHECK (("status" = 'GONDERILIYOR') = ("claim_until" IS NOT NULL));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_deneme_negatif_degil" CHECK ("attempts" >= 0);

-- RLS — kiracı yalıtımı (tek yazar `src/lib/tenant.ts`); ayarsız bağlantıda sorgu HATA verir (fail-closed).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_defaults', 'notification_preferences', 'notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tesis_yalitimi ON %I USING (tesis_id = current_setting(''app.tesis_id'')::uuid) '
      'WITH CHECK (tesis_id = current_setting(''app.tesis_id'')::uuid)', t);
  END LOOP;
END $$;
