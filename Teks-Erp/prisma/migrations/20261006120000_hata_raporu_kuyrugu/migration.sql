-- Hata raporu kuyruğu (müşteri onaylı, kişisel verisiz; TELEMETRİ — budanır). Yalnız YENİ tablo ekler:
-- mevcut tablolara ve DEFERRABLE FK'lara dokunmaz. Onay yoksa tabloya hiç satır yazılmaz (bugünkü davranış).
-- İdempotent: yeniden koşum no-op.
CREATE TABLE IF NOT EXISTS "error_report_entries" (
    "id" UUID NOT NULL,
    "pendingKey" CHAR(64),
    "groupKey" CHAR(64) NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "version" VARCHAR(60) NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "errorClass" VARCHAR(60) NOT NULL,
    "component" VARCHAR(40) NOT NULL,
    "routeTemplate" VARCHAR(200),
    "stackFrames" VARCHAR(160)[],
    "count" INTEGER NOT NULL,
    "firstAt" TIMESTAMPTZ NOT NULL,
    "lastAt" TIMESTAMPTZ NOT NULL,
    "batchId" UUID,
    "sentAt" TIMESTAMPTZ,
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(60),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "error_report_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "error_report_entries_count_check" CHECK ("count" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "error_report_entries_pendingKey_key" ON "error_report_entries"("pendingKey");
CREATE INDEX IF NOT EXISTS "error_report_entries_sentAt_batchId_idx" ON "error_report_entries"("sentAt", "batchId");
CREATE INDEX IF NOT EXISTS "error_report_entries_createdAt_idx" ON "error_report_entries"("createdAt");
