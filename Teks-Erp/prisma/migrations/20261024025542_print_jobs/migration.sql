-- =============================================================================
-- 2026-10-24 — print_jobs: yazdırma geçmişi (izlenebilirlik A1)
-- NE YAPAR: yeni TELEMETRİ tablosu `print_jobs` (kim · ne · hangi yazıcı · sonuç). Hiçbir iş kararı okumaz
-- (top iptal guard'ı `rolls.labelPrintedAt` okur); `printLog.retentionDays` (varsayılan 180) yaşında budanır.
-- ADDITIVE · idempotent · mevcut tabloya dokunmaz (yalnız üç FK yeni tablodan dışarı bakar).
-- Şema dışı nesneler (CHECK ×5 · kısmi createdAt WHERE status='HATA') `test_db_invariants`te; GIN şemada (`type: Gin`).
-- `--create-only` çıktısındaki iki DEFERRABLE composite FK DropForeignKey satırı SİLİNDİ ([DB-21]).
-- =============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "print_jobs" (
    "id" UUID NOT NULL,
    "clientToken" UUID,
    "requestId" UUID,
    "userId" UUID,
    "deviceRefId" UUID,
    "source" VARCHAR(16) NOT NULL,
    "outputKind" VARCHAR(8) NOT NULL DEFAULT 'PRINTER',
    "appVersion" VARCHAR(32),
    "stationId" UUID,
    "machineId" UUID,
    "subjectKind" VARCHAR(40) NOT NULL,
    "docType" "PrintedDocType",
    "subjectTable" VARCHAR(48),
    "subjectId" UUID,
    "subjectIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "subjectNo" VARCHAR(64),
    "printedDocumentId" UUID,
    "docVersion" INTEGER,
    "itemCount" INTEGER NOT NULL DEFAULT 1,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "isReprint" BOOLEAN,
    "transport" VARCHAR(16),
    "peripheralDeviceId" UUID,
    "printerName" VARCHAR(120),
    "printerAddress" VARCHAR(128),
    "language" "PrinterLanguage",
    "status" VARCHAR(12) NOT NULL,
    "errorCode" VARCHAR(60),
    "errorMessage" VARCHAR(300),
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "durationMs" INTEGER,
    "bytes" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "print_jobs_clientToken_key" ON "print_jobs"("clientToken");
CREATE INDEX IF NOT EXISTS "print_jobs_createdAt_idx" ON "print_jobs"("createdAt");
CREATE INDEX IF NOT EXISTS "print_jobs_userId_createdAt_idx" ON "print_jobs"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "print_jobs_peripheralDeviceId_createdAt_idx" ON "print_jobs"("peripheralDeviceId", "createdAt");
CREATE INDEX IF NOT EXISTS "print_jobs_deviceRefId_createdAt_idx" ON "print_jobs"("deviceRefId", "createdAt");
CREATE INDEX IF NOT EXISTS "print_jobs_subjectTable_subjectId_idx" ON "print_jobs"("subjectTable", "subjectId");

-- GIN: toplu basımın top araması (`subjectIds @> {X}`) · kısmi (şema dışı): hata süzgeci / en çok hata veren yazıcı.
CREATE INDEX IF NOT EXISTS "print_jobs_subjectIds_gin" ON "print_jobs" USING GIN ("subjectIds");
CREATE INDEX IF NOT EXISTS "print_jobs_hata_createdAt_idx" ON "print_jobs"("createdAt") WHERE "status" = 'HATA';

-- AddForeignKey + CHECK seddi (servis Zod'la doğrular; DB son kapı)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_userId_fkey') THEN
    ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_deviceRefId_fkey') THEN
    ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_deviceRefId_fkey" FOREIGN KEY ("deviceRefId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_peripheralDeviceId_fkey') THEN
    ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_peripheralDeviceId_fkey" FOREIGN KEY ("peripheralDeviceId") REFERENCES "peripheral_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_output_kind_check') THEN
    ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_output_kind_check" CHECK ("outputKind" IN ('PRINTER', 'PDF'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_status_check') THEN
    ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_status_check" CHECK ("status" IN ('ILETILDI', 'HATA', 'IPTAL', 'BELIRSIZ', 'SIMULE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_hata_kodu_check') THEN
    ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_hata_kodu_check" CHECK ("status" <> 'HATA' OR "errorCode" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_adet_check') THEN
    ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_adet_check" CHECK ("itemCount" >= 1 AND "copies" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_subject_ids_max_check') THEN
    ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_subject_ids_max_check" CHECK ("subjectIds" IS NULL OR cardinality("subjectIds") <= 200);
  END IF;
END $$;
