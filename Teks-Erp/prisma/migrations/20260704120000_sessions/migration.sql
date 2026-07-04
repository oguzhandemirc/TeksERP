-- Oturum kaydı (sessions): anlık JWT iptal + aynı-tip cihaz oturum politikası
-- (kick/notify/off). jti login'de üretilir; auth.middleware her istekte revokedAt
-- kontrol eder → iptal edilen oturum bir sonraki istekte 401 alır.
-- (Manuel migration — repo konvansiyonu: psql apply + prisma migrate resolve --applied.)
-- NOT: (userId, deviceType) üzerinde partial-unique index YOK — kasıtlı. 'off'/'notify'
-- politikaları çoklu aktif same-type oturum gerektirir; teklik ('kick') uygulama
-- katmanında (SessionRegistryService.openLoginSession) sağlanır.

CREATE TYPE "ClientType" AS ENUM ('ELECTRON', 'MOBILE');

CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceType" "ClientType" NOT NULL,
    "jti" UUID NOT NULL,
    "deviceId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" VARCHAR(32),
    "lastSeenAt" TIMESTAMP(3),
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sessions_jti_key" ON "sessions"("jti");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- Ayak izi korunur — kullanıcı silinirken (soft-delete kalıbı) oturum geçmişi kaybolmaz.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
