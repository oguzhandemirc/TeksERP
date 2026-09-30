-- İlk kurulum sözleşme kabulü (Ek-7; kullanıcı kararı 2026-09-30: kabul kaydı olmadan etkinleştirme satıcıda RED).
-- Yalnız EKLER: boş doğan ekleme-yalnız tablo; canlı veriye dokunmaz. DEFERRABLE FK'lara dokunulmaz (DropForeignKey
-- satırları çıkarıldı). İdempotent: yeniden koşum no-op.

CREATE TABLE IF NOT EXISTS "license_acceptances" (
    "id" UUID NOT NULL,
    "clientToken" UUID,
    "textId" VARCHAR(40) NOT NULL,
    "textDigest" VARCHAR(64) NOT NULL,
    "boxes" TEXT[],
    "acceptorName" VARCHAR(120) NOT NULL,
    "acceptorTitle" VARCHAR(120) NOT NULL,
    "acceptedById" UUID NOT NULL,
    "installationKeyId" VARCHAR(64) NOT NULL,
    "licenseId" UUID,
    "clientVersion" VARCHAR(60),
    "serverVersion" VARCHAR(60) NOT NULL,
    "document" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "license_acceptances_clientToken_key" ON "license_acceptances"("clientToken");

CREATE INDEX IF NOT EXISTS "license_acceptances_installationKeyId_createdAt_idx" ON "license_acceptances"("installationKeyId", "createdAt");

DO $kabul_fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'license_acceptances_acceptedById_fkey') THEN
    ALTER TABLE "license_acceptances" ADD CONSTRAINT "license_acceptances_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$kabul_fk$;
