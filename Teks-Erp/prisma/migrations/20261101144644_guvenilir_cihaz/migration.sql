-- Web girişinde "Bu cihazı N gün hatırla" (2026-11-01). Yeni tablo + oturuma "yeni cihaz" işareti;
-- mevcut satırlara dokunulmaz (toplu UPDATE yok). Açık belirteç saklanmaz — yalnız HMAC özeti.

-- Giriş geçmişi: web girişinde tarayıcı tanınmadı mı (NULL = web dışı / eski oturum, ölçülmedi).
ALTER TABLE "sessions" ADD COLUMN     "newDevice" BOOLEAN;

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(100) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "firstIp" VARCHAR(64),
    "tokenVersion" INTEGER NOT NULL,
    "lastUsedAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(32),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_tokenHash_key" ON "trusted_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "trusted_devices_userId_revokedAt_idx" ON "trusted_devices"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Özet biçimi: `<16 hex kid>:<64 hex HMAC>` — açık belirteç bu kolona yazılamaz.
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_token_hash_format_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{16}:[0-9a-f]{64}$');

-- İptal çifti birlikte dolar; sebep kapalı küme.
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_revoke_pair_check"
  CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL));
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_revoke_reason_check"
  CHECK ("revokeReason" IS NULL OR "revokeReason" IN ('SELF', 'ADMIN', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'TOTP_RESET', 'DEACTIVATED'));

-- Süre: doğuştan sonra biter.
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_expiry_check"
  CHECK ("expiresAt" > "createdAt");
