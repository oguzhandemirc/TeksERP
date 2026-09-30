-- Fabrika saat dilimi DÖNEM DEFTERİ (kullanıcı kararı 2026-09-30: "geçmiş kayıtlar etkilenmesin, saat dilimi
-- değiştirildikten sonraki kayıtları etkilesin"). Yalnız EKLER: tablo boş doğar = bütün zaman Europe/Istanbul
-- (bugünkü davranış). Ekleme-yalnız; iptal aynı validFrom'da ters kayıttır (reversesPeriodId), satır silinmez.

-- CreateTable
CREATE TABLE "factory_timezone_periods" (
    "id" UUID NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,
    "validFrom" TIMESTAMPTZ NOT NULL,
    "reason" VARCHAR(200),
    "reversesPeriodId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_timezone_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "factory_timezone_periods_timezone_not_blank" CHECK (btrim("timeZone") <> '')
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_timezone_periods_reversesPeriodId_key" ON "factory_timezone_periods"("reversesPeriodId");

-- CreateIndex
CREATE INDEX "factory_timezone_periods_validFrom_createdAt_idx" ON "factory_timezone_periods"("validFrom", "createdAt");

-- CreateIndex
CREATE INDEX "factory_timezone_periods_createdById_idx" ON "factory_timezone_periods"("createdById");

-- AddForeignKey
ALTER TABLE "factory_timezone_periods" ADD CONSTRAINT "factory_timezone_periods_reversesPeriodId_fkey" FOREIGN KEY ("reversesPeriodId") REFERENCES "factory_timezone_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_timezone_periods" ADD CONSTRAINT "factory_timezone_periods_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
