-- Push köprüsü P2 (2026-11-13): patron telefonunun Expo push belirteci (fabrika tarafı).
-- ADDITIVE: tek yeni tablo; mevcut veriye dokunmaz, backfill YOK. Satır silinmez (bırakma durum geçişi).

-- CreateTable
CREATE TABLE "patron_push_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID,
    "tokenDigest" VARCHAR(64) NOT NULL,
    "tokenSealed" TEXT,
    "platform" VARCHAR(16) NOT NULL,
    "deviceName" VARCHAR(80),
    "cloudState" VARCHAR(16) NOT NULL DEFAULT 'BEKLIYOR',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ,
    "lastErrorCode" VARCHAR(64),
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "patron_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patron_push_tokens_tokenDigest_key" ON "patron_push_tokens"("tokenDigest");

-- CreateIndex
CREATE INDEX "patron_push_tokens_userId_cloudState_idx" ON "patron_push_tokens"("userId", "cloudState");

-- CreateIndex
CREATE INDEX "patron_push_tokens_sessionId_idx" ON "patron_push_tokens"("sessionId");

-- CreateIndex
CREATE INDEX "patron_push_tokens_cloudState_nextAttemptAt_idx" ON "patron_push_tokens"("cloudState", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ŞEMA-DIŞI: kapalı kümeler + çift yüklem seddi (servis `services/patron-push/` ilk hat, bunlar son hat).
ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_cloud_state_ck" CHECK ("cloudState" IN ('BEKLIYOR', 'KAYITLI', 'BIRAKILACAK', 'BIRAKILDI'));
ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_platform_ck" CHECK ("platform" IN ('android', 'ios'));
ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_digest_ck" CHECK ("tokenDigest" ~ '^[0-9a-f]{64}$');
-- Ham belirteç yalnız canlı (BEKLIYOR/KAYITLI) satırda durur; bırakılan satır onu taşıyamaz.
ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_sealed_live_ck" CHECK (("cloudState" IN ('BEKLIYOR', 'KAYITLI')) = ("tokenSealed" IS NOT NULL));
ALTER TABLE "patron_push_tokens" ADD CONSTRAINT "patron_push_tokens_released_ck" CHECK (("cloudState" = 'BIRAKILDI') = ("releasedAt" IS NOT NULL));
