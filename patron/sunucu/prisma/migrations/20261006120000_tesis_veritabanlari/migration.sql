-- =============================================================================
-- TESİS BAŞINA AYRI VERİTABANI — merkez yönlendirme kataloğu (docs/design/PATRON-TESIS-DB.md §2).
-- Şema tektir: bu tablolar her DB'de doğar, yalnız MERKEZDE dolar ve yalnız merkezde çalışma rollerine
-- yetkilidir (`src/lib/db-grants.ts` MERKEZ_*). Kiracı verisi değildir ⇒ RLS taşımaz. Veri DEĞİŞMEZ (yeni tablolar).
-- =============================================================================

-- CreateEnum
CREATE TYPE "FacilityDbStatus" AS ENUM ('ISTENDI', 'HAZIR', 'IMHA_SURUYOR', 'IMHA_EDILDI');

-- CreateTable
CREATE TABLE "facility_databases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tesis_id" UUID NOT NULL,
    "database_name" VARCHAR(63),
    "status" "FacilityDbStatus" NOT NULL DEFAULT 'ISTENDI',
    "schema_version" VARCHAR(255),
    "claim_owner" VARCHAR(80),
    "claim_until" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,
    "last_error" VARCHAR(500),
    "migrated_at" TIMESTAMPTZ,
    "migration_error" VARCHAR(500),
    "destruction_plan" JSONB,
    "ready_at" TIMESTAMPTZ,
    "destroyed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_databases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kurulum_id" UUID NOT NULL,
    "tesis_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email_digest" VARCHAR(64) NOT NULL,
    "tesis_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "facility_databases_tesis_id_key" ON "facility_databases"("tesis_id");

-- CreateIndex
CREATE UNIQUE INDEX "facility_databases_database_name_key" ON "facility_databases"("database_name");

-- CreateIndex
CREATE INDEX "facility_databases_status_next_attempt_at_idx" ON "facility_databases"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "installation_routes_kurulum_id_key" ON "installation_routes"("kurulum_id");

-- CreateIndex
CREATE INDEX "installation_routes_tesis_id_idx" ON "installation_routes"("tesis_id");

-- CreateIndex
CREATE UNIQUE INDEX "login_routes_email_digest_key" ON "login_routes"("email_digest");

-- CreateIndex
CREATE UNIQUE INDEX "login_routes_account_id_key" ON "login_routes"("account_id");

-- CreateIndex
CREATE INDEX "login_routes_tesis_id_idx" ON "login_routes"("tesis_id");


-- Seddler: ad biçimi belirlenimli; HAZIR satırın adı, şema sürümü ve hazır anı dolu; imha bitişi damgalı.
ALTER TABLE "facility_databases" ADD CONSTRAINT "facility_databases_ad_bicimi"
  CHECK ("database_name" IS NULL OR "database_name" ~ '^[a-z_][a-z0-9_]*_t[0-9a-f]{16}$');
ALTER TABLE "facility_databases" ADD CONSTRAINT "facility_databases_hazir_dolu"
  CHECK ("status" = 'ISTENDI' OR ("database_name" IS NOT NULL AND "schema_version" IS NOT NULL AND "ready_at" IS NOT NULL));
ALTER TABLE "facility_databases" ADD CONSTRAINT "facility_databases_imha_damgali"
  CHECK ("status" <> 'IMHA_EDILDI' OR "destroyed_at" IS NOT NULL);
ALTER TABLE "facility_databases" ADD CONSTRAINT "facility_databases_deneme_pozitif" CHECK ("attempts" >= 0);
ALTER TABLE "login_routes" ADD CONSTRAINT "login_routes_ozet_bicimi" CHECK ("email_digest" ~ '^[0-9a-f]{64}$');

-- Kurulum → tesis bağı DEĞİŞMEZ: tesisi başka tesise çeviren UPDATE reddedilir (yönlendirme sızıntısı sınıfı).
CREATE FUNCTION "kurulum_yonu_degismez"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tesis_id <> OLD.tesis_id OR NEW.kurulum_id <> OLD.kurulum_id THEN
    RAISE EXCEPTION 'installation_routes: kurulum → tesis bağı değiştirilemez' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION "kurulum_yonu_degismez"() FROM PUBLIC;
CREATE TRIGGER installation_routes_degismez BEFORE UPDATE ON "installation_routes"
  FOR EACH ROW EXECUTE FUNCTION "kurulum_yonu_degismez"();
