-- =============================================================================
-- 2026-10-24 — request_traces: istek başlığı (izlenebilirlik B1)
-- NE YAPAR: yeni TELEMETRİ tablosu `request_traces` (kim · hangi uç · hangi cihaz · durum · süre · audit sayısı).
-- `id` = istek bağlamının requestId'si (audit `system_logs.requestId` ile aynı). GÖVDE/sorgu/başlık değeri YOK.
-- Hiçbir karar okumaz; `requestTrace.retentionDays` (varsayılan 90) yaşında budanır.
-- ADDITIVE · idempotent · mevcut tabloya dokunmaz (yalnız bir FK yeni tablodan `devices`a bakar).
-- Şema dışı nesne (kısmi `(createdAt) WHERE status >= 400`) `test_db_invariants`te.
-- `--create-only` çıktısındaki iki DEFERRABLE composite FK DropForeignKey satırı SİLİNDİ ([DB-21]).
-- =============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "request_traces" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "deviceRefId" UUID,
    "deviceLocalId" VARCHAR(64),
    "clientType" VARCHAR(16),
    "appVersion" VARCHAR(32),
    "ip" VARCHAR(64),
    "method" VARCHAR(8) NOT NULL,
    "routeKey" VARCHAR(160) NOT NULL,
    "status" SMALLINT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "errorCode" VARCHAR(60),
    "auditCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "request_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "request_traces_createdAt_idx" ON "request_traces"("createdAt");
CREATE INDEX IF NOT EXISTS "request_traces_userId_createdAt_idx" ON "request_traces"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "request_traces_deviceRefId_createdAt_idx" ON "request_traces"("deviceRefId", "createdAt");
-- Kısmi: "reddedilen istekler" süzgeci yalnız hata satırlarını tarar (şema dışı, test_db_invariants).
CREATE INDEX IF NOT EXISTS "request_traces_hata_createdAt_idx" ON "request_traces"("createdAt") WHERE "status" >= 400;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_traces_deviceRefId_fkey') THEN
    ALTER TABLE "request_traces" ADD CONSTRAINT "request_traces_deviceRefId_fkey" FOREIGN KEY ("deviceRefId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
