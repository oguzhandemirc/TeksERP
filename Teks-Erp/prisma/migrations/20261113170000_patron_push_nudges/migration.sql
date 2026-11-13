-- Push köprüsü P3 (2026-11-13): patron telefonu DÜRT kuyruğu (gelen kutusu satırı başına).
-- ADDITIVE: tek yeni tablo; mevcut veriye dokunmaz, backfill YOK. TELEMETRİ/iş kuyruğu (defter değil): terminal satır
-- 7 günde budanır, kutu satırı budanınca CASCADE gider. Metin ve belirteç taşımaz.

-- CreateTable
CREATE TABLE "patron_push_nudges" (
    "id" UUID NOT NULL,
    "inboxId" UUID NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'BEKLIYOR',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ,
    "claimedAt" TIMESTAMPTZ,
    "lastErrorCode" VARCHAR(64),
    "finishedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "patron_push_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patron_push_nudges_inboxId_idx" ON "patron_push_nudges"("inboxId");

-- CreateIndex
CREATE INDEX "patron_push_nudges_state_nextAttemptAt_idx" ON "patron_push_nudges"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "patron_push_nudges_finishedAt_idx" ON "patron_push_nudges"("finishedAt");

-- AddForeignKey
ALTER TABLE "patron_push_nudges" ADD CONSTRAINT "patron_push_nudges_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "notification_inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ŞEMA-DIŞI: kapalı küme + çift yüklem seddi (servis `services/patron-push/` ilk hat, bunlar son hat).
ALTER TABLE "patron_push_nudges" ADD CONSTRAINT "patron_push_nudges_state_ck" CHECK ("state" IN ('BEKLIYOR', 'GONDERILIYOR', 'GONDERILDI', 'IPTAL', 'ATLANDI', 'VAZGECILDI'));
ALTER TABLE "patron_push_nudges" ADD CONSTRAINT "patron_push_nudges_finished_ck" CHECK (("state" IN ('GONDERILDI', 'IPTAL', 'ATLANDI', 'VAZGECILDI')) = ("finishedAt" IS NOT NULL));
ALTER TABLE "patron_push_nudges" ADD CONSTRAINT "patron_push_nudges_claimed_ck" CHECK (("state" = 'GONDERILIYOR') = ("claimedAt" IS NOT NULL));
-- Kutu satırı başına en çok bir canlı dürt: dağıtıcının ON CONFLICT DO NOTHING hedefi (birleşen olay ikinci dürt doğurmaz).
CREATE UNIQUE INDEX "patron_push_nudges_live_inbox_uq" ON "patron_push_nudges"("inboxId") WHERE "state" IN ('BEKLIYOR', 'GONDERILIYOR');
