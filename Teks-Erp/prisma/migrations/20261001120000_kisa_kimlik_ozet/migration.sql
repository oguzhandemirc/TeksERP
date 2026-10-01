-- G21 kısa kimlikler (hızlı PIN + QR kart) özetli saklama · anahtar emaneti · kalıcı giriş kilidi.
-- Yalnız EKLER: users'a beş boş/varsayılanlı kolon, iki boş tablo. Canlı veriye DOKUNMAZ — düz
-- quickPin/cardToken'ın özete dönüşümü migration'ın İÇİNDE DEĞİL (HMAC anahtarı DB'de yok):
-- ayrı yayın günü adımı `scripts/kisa-kimlik.ts donustur` (dry-run → onay → --apply), düz
-- kolonlar silinmez. DEFERRABLE FK'lara dokunulmaz. İdempotent: yeniden koşum no-op.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "quickPinDigest" VARCHAR(96);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "quickPinSetAt" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cardTokenDigest" VARCHAR(96);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cardIssuedAt" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cardTokenLegacy" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "users_quickPinDigest_key" ON "users"("quickPinDigest");
CREATE UNIQUE INDEX IF NOT EXISTS "users_cardTokenDigest_key" ON "users"("cardTokenDigest");

CREATE TABLE IF NOT EXISTS "short_credential_key_escrows" (
    "id" UUID NOT NULL,
    "kid" VARCHAR(16) NOT NULL,
    "sealed" TEXT NOT NULL,
    "recipientFingerprints" VARCHAR(400) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "short_credential_key_escrows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "short_credential_key_escrows_kid_key" ON "short_credential_key_escrows"("kid");

CREATE TABLE IF NOT EXISTS "login_lockout_buckets" (
    "id" UUID NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "penaltyRounds" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMPTZ,
    "lastFailAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "login_lockout_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "login_lockout_buckets_keyHash_key" ON "login_lockout_buckets"("keyHash");
CREATE INDEX IF NOT EXISTS "login_lockout_buckets_lastFailAt_idx" ON "login_lockout_buckets"("lastFailAt");
