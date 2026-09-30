-- =============================================================================
-- KAPANAN HESABIN KİMLİĞİ (Ek-6/A §2.5): kapanış anı + kimlik silme damgası. Yalnız EKLER.
-- `closed_at` PASIF geçişiyle AYNI atomik claim'de yazılır (tek yazar `setAccountStatus`); mevcut PASIF
-- hesapların anı `updated_at`ten alınır — bilinen en yakın an, gerçek kapanıştan ÖNCE değildir (erken
-- silmez). Kimlik silme işi (bakım tiki) kapanıştan 30 gün sonra ad/e-posta/parola/TOTP'yi siler, satırı
-- ve kimliği KORUR (iş kayıtlarının izi kırılmaz). Göç rolü süper kullanıcıdır (RLS FORCE'u aşar).
-- =============================================================================

ALTER TABLE "accounts" ADD COLUMN "closed_at" TIMESTAMPTZ;
ALTER TABLE "accounts" ADD COLUMN "identity_purged_at" TIMESTAMPTZ;

UPDATE "accounts" SET "closed_at" = "updated_at" WHERE "status" = 'PASIF' AND "closed_at" IS NULL;

-- Çift yüklem: PASIF ⇔ kapanış anı (iki yazar da DB'de seddedilir).
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_closed_pair_check"
  CHECK (("status" = 'PASIF') = ("closed_at" IS NOT NULL));
-- Kimliği silinmiş hesap PASIF'tir ve hiçbir giriş sırrı taşımaz.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_purged_no_secret_check"
  CHECK ("identity_purged_at" IS NULL OR ("status" = 'PASIF' AND "password_hash" IS NULL AND "totp_secret_sealed" IS NULL AND "invite_token_hash" IS NULL));

-- Silme işinin taraması: kapanmış, kimliği henüz silinmemiş hesaplar.
CREATE INDEX "accounts_kimlik_silme_idx" ON "accounts" ("tesis_id", "closed_at") WHERE "identity_purged_at" IS NULL AND "closed_at" IS NOT NULL;
