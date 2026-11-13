-- V5a (2026-11-13): patron uygulamasının İSTEK ÜZERİNE oluşturduğu rapor koşumları + sonuçları.
-- ADDITIVE: tek yeni tablo; mevcut veriye dokunmaz, backfill YOK. TELEMETRİ (türetilmiş önbellek): satır silinince
-- raporlanan sayı değişmez; tek budayıcı `src/services/patron-rapor/budama.ts`.

-- CreateTable
CREATE TABLE "patron_report_runs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reportKey" VARCHAR(80) NOT NULL,
    "params" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'HESAPLANIYOR',
    "errorCode" VARCHAR(64),
    "result" JSONB,
    "resultBytes" INTEGER,
    "durationMs" INTEGER,
    "finishedAt" TIMESTAMPTZ,
    "clientToken" UUID,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "patron_report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patron_report_runs_clientToken_key" ON "patron_report_runs"("clientToken");

-- CreateIndex
CREATE INDEX "patron_report_runs_userId_reportKey_createdAt_idx" ON "patron_report_runs"("userId", "reportKey", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "patron_report_runs_createdAt_idx" ON "patron_report_runs"("createdAt");

-- AddForeignKey
ALTER TABLE "patron_report_runs" ADD CONSTRAINT "patron_report_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ŞEMA-DIŞI: durum kapalı küme (VarChar + CHECK).
ALTER TABLE "patron_report_runs" ADD CONSTRAINT "patron_report_runs_status_ck" CHECK ("status" IN ('HESAPLANIYOR', 'HAZIR', 'HATA'));
