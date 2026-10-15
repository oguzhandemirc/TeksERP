-- =============================================================================
-- TEK KİMLİK → ÇOK TESİS (kullanıcı kararı 2026-10-15): e-posta + parola + TOTP merkezde `identities`te; tesis
-- hesabı (`accounts`) üyeliğin tesis tarafıdır (ad, e-posta, izin, durum) ve kimliğe `identity_id` ile bağlanır.
-- `login_routes` üyeliktir: (kimlik, tesis) → hesap. Tek göç zinciri her DB'ye uygulanır; `identities` yalnız merkezde
-- dolar ve yetkilidir (`src/lib/db-grants.ts` MERKEZ_*). Kiracı verisi değildir ⇒ RLS taşımaz.
-- VERİ TAŞIMA YOK (üretim ölçümü 2026-10-15: 0 hesap, 0 giriş satırı) — fail-closed: etkin hesap ya da giriş satırı
-- varsa göç hiçbir şey değiştirmeden DURUR (sır kolonları düşerken kimliğe taşınmamış sır kaybolmasın).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "accounts" WHERE "status" IN ('AKTIF', 'KILITLI')) THEN
    RAISE EXCEPTION 'tek_kimlik: etkin (AKTIF/KILITLI) hesap var — parola/TOTP sırrı kimliğe taşınmadan düşürülemez; göç durdu';
  END IF;
  IF EXISTS (SELECT 1 FROM "login_routes") THEN
    RAISE EXCEPTION 'tek_kimlik: giriş dizininde satır var — kimliğe bağlanmadan dönüştürülemez; göç durdu';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('DAVETLI', 'AKTIF', 'PASIF');

-- CreateTable
CREATE TABLE "identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email_digest" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(200),
    "totp_secret_sealed" VARCHAR(300),
    "totp_last_step" INTEGER,
    "status" "IdentityStatus" NOT NULL DEFAULT 'DAVETLI',
    "closed_at" TIMESTAMPTZ,
    "identity_purged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identities_email_digest_key" ON "identities"("email_digest");

-- Seddler: özet biçimi; TOTP ZORUNLU (AKTIF kimlik sırsız doğamaz); kapanış çifti; silinmiş kimlik sır taşımaz.
ALTER TABLE "identities" ADD CONSTRAINT "identities_ozet_bicimi" CHECK ("email_digest" ~ '^[0-9a-f]{64}$');
ALTER TABLE "identities" ADD CONSTRAINT "identities_active_needs_totp_check"
  CHECK ("status" <> 'AKTIF' OR ("password_hash" IS NOT NULL AND "totp_secret_sealed" IS NOT NULL AND "totp_last_step" IS NOT NULL));
ALTER TABLE "identities" ADD CONSTRAINT "identities_closed_pair_check"
  CHECK (("status" = 'PASIF') = ("closed_at" IS NOT NULL));
ALTER TABLE "identities" ADD CONSTRAINT "identities_purged_no_secret_check"
  CHECK ("identity_purged_at" IS NULL OR ("status" = 'PASIF' AND "password_hash" IS NULL AND "totp_secret_sealed" IS NULL));

-- Üyelik: e-posta özeti kimliğe geçer; kimlik tesis başına tek hesap.
DROP INDEX "login_routes_email_digest_key";
ALTER TABLE "login_routes" DROP CONSTRAINT "login_routes_ozet_bicimi";
ALTER TABLE "login_routes" DROP COLUMN "email_digest";
ALTER TABLE "login_routes" ADD COLUMN "identity_id" UUID NOT NULL;
CREATE UNIQUE INDEX "login_routes_identity_id_tesis_id_key" ON "login_routes"("identity_id", "tesis_id");
ALTER TABLE "login_routes" ADD CONSTRAINT "login_routes_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tesis hesabı: sır kolonları kimliğe geçti; eski hesap düzeyi kilit sayaçları (karar vermiyordu) düşer.
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_active_needs_totp_check";
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_purged_no_secret_check";
ALTER TABLE "accounts" DROP COLUMN "password_hash";
ALTER TABLE "accounts" DROP COLUMN "totp_secret_sealed";
ALTER TABLE "accounts" DROP COLUMN "totp_last_step";
ALTER TABLE "accounts" DROP COLUMN "failed_logins";
ALTER TABLE "accounts" DROP COLUMN "locked_until";
ALTER TABLE "accounts" ADD COLUMN "identity_id" UUID;

-- Etkin hesap kimliksiz olamaz (giriş kimlikten gelir); kimliği silinmiş hesap PASİF, davetsiz ve kimlik bağsızdır.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_active_needs_identity_check"
  CHECK ("status" NOT IN ('AKTIF', 'KILITLI') OR "identity_id" IS NOT NULL);
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_purged_no_secret_check"
  CHECK ("identity_purged_at" IS NULL OR ("status" = 'PASIF' AND "invite_token_hash" IS NULL AND "identity_id" IS NULL));

-- Giriş artık kimlikten üyeliğe çözülür (tesis + hesap kimliği bilinir): e-postayla ön-kiracı araması kalkar.
DROP POLICY "giris_arama" ON "accounts";
