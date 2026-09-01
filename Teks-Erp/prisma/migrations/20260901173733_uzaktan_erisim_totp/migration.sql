-- =============================================================================
-- UZAKTAN ERİŞİM (patron modülü) — ClientType.WEB + TOTP
-- =============================================================================
-- ⚠️ Prisma'nın ürettiği İKİ `DropForeignKey` satırı ELLE SİLİNDİ
-- (`rolls_sackId_shipmentId_consistency_fkey` + `swatches_...`). Bu DEFERRABLE
-- composite FK'lar datamodel'de temsil edilemediği için `migrate dev` onları HER
-- diff'te düşürmek ister; bırakılsaydı bu migration canlıda iki tutarlılık
-- seddini sessizce kaldırırdı. Bkz. Teks-Erp/CLAUDE.md → perf kuralı 4.
--
-- `ALTER TYPE ... ADD VALUE` PG 12+'da işlem bloğu içinde koşabilir; yeni değer
-- AYNI işlemde KULLANILAMAZ — burada yalnız ekleniyor, kullanan kod sonraki
-- deploy'da geliyor (backend ÖNCE kuralı).
-- =============================================================================

-- AlterEnum
ALTER TYPE "ClientType" ADD VALUE 'WEB';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totpEnabledAt" TIMESTAMPTZ,
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" VARCHAR(64);

-- CreateTable
CREATE TABLE "totp_enrollments" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "token" UUID NOT NULL,
    "secret" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "totp_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" VARCHAR(72) NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "totp_enrollments_token_key" ON "totp_enrollments"("token");

-- CreateIndex
CREATE INDEX "totp_enrollments_userId_idx" ON "totp_enrollments"("userId");

-- CreateIndex
CREATE INDEX "user_recovery_codes_userId_idx" ON "user_recovery_codes"("userId");

-- AddForeignKey
ALTER TABLE "totp_enrollments" ADD CONSTRAINT "totp_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_enrollments" ADD CONSTRAINT "totp_enrollments_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
