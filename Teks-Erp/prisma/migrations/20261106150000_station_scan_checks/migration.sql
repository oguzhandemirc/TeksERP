-- İstasyon belge okutma doğrulama izi (TELEMETRİ, 2026-11-06). ADDITIVE: yeni tablo + index; mevcut veriye dokunmaz.
-- İdempotent (IF NOT EXISTS) — apply-migration.ts ikinci koşumda da güvenli.
CREATE TABLE IF NOT EXISTS "station_scan_checks" (
    "id" UUID NOT NULL,
    "screen" VARCHAR(16),
    "source" VARCHAR(16) NOT NULL,
    "readDocNo" VARCHAR(64),
    "readBatchNo" VARCHAR(64),
    "threshold" SMALLINT NOT NULL,
    "bestScore" SMALLINT,
    "candidateCount" SMALLINT NOT NULL,
    "verifiedCount" SMALLINT NOT NULL,
    "decision" VARCHAR(16) NOT NULL,
    "components" JSONB,
    "bestWorkOrderNumber" VARCHAR(64),
    "openedWorkOrderNumber" VARCHAR(64),
    "openedHow" VARCHAR(16),
    "openedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "station_scan_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "station_scan_checks_createdAt_idx" ON "station_scan_checks"("createdAt");
