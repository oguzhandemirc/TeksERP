-- CreateEnum
CREATE TYPE "CustomerCodeSource" AS ENUM ('BOUND_LABEL', 'CUSTOMER_SERIES', 'DELIVERY_NOTE');

-- CreateTable
CREATE TABLE "roll_customer_codes" (
    "id" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "source" "CustomerCodeSource" NOT NULL,
    "seriesId" UUID,
    "clientToken" UUID NOT NULL,
    "createdById" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "roll_customer_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_barcode_series" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "dateSegment" "NumberSeriesDateSegment" NOT NULL DEFAULT 'NONE',
    "digits" INTEGER NOT NULL DEFAULT 4,
    "separator" VARCHAR(2) NOT NULL DEFAULT '',
    "startValue" INTEGER,
    "maxValue" INTEGER,
    "formatChangedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clientToken" UUID NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_barcode_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roll_customer_codes_clientToken_key" ON "roll_customer_codes"("clientToken");

-- CreateIndex
CREATE INDEX "roll_customer_codes_code_idx" ON "roll_customer_codes"("code");

-- CreateIndex
CREATE INDEX "roll_customer_codes_rollId_createdAt_idx" ON "roll_customer_codes"("rollId", "createdAt");

-- CreateIndex
CREATE INDEX "roll_customer_codes_seriesId_idx" ON "roll_customer_codes"("seriesId");

-- CreateIndex
CREATE INDEX "roll_customer_codes_createdById_idx" ON "roll_customer_codes"("createdById");

-- CreateIndex
CREATE INDEX "roll_customer_codes_revokedById_idx" ON "roll_customer_codes"("revokedById");

-- D4-F1: PARTIAL tekillik — müşteride aktif kod tekil · topta tek aktif kod (damgalı geçmiş serbest).
CREATE UNIQUE INDEX "roll_customer_codes_customer_code_active_uq" ON "roll_customer_codes"("customerId", "code") WHERE "revokedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "roll_customer_codes_roll_active_uq" ON "roll_customer_codes"("rollId") WHERE "revokedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "customer_barcode_series_customerId_key" ON "customer_barcode_series"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_barcode_series_clientToken_key" ON "customer_barcode_series"("clientToken");

-- CreateIndex
CREATE INDEX "customer_barcode_series_createdById_idx" ON "customer_barcode_series"("createdById");

-- AddForeignKey
ALTER TABLE "roll_customer_codes" ADD CONSTRAINT "roll_customer_codes_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_customer_codes" ADD CONSTRAINT "roll_customer_codes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_customer_codes" ADD CONSTRAINT "roll_customer_codes_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "customer_barcode_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_customer_codes" ADD CONSTRAINT "roll_customer_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_customer_codes" ADD CONSTRAINT "roll_customer_codes_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_barcode_series" ADD CONSTRAINT "customer_barcode_series_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_barcode_series" ADD CONSTRAINT "customer_barcode_series_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- D4-F1 seddi: kod boş olamaz · damga ile sebep birlikte · seri bağı yalnız CUSTOMER_SERIES kaynağında.
ALTER TABLE "roll_customer_codes" ADD CONSTRAINT "roll_customer_codes_code_ck" CHECK (btrim("code") <> '');
ALTER TABLE "roll_customer_codes" ADD CONSTRAINT "roll_customer_codes_revoke_ck" CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL));
ALTER TABLE "roll_customer_codes" ADD CONSTRAINT "roll_customer_codes_series_ck" CHECK ("seriesId" IS NULL OR "source" = 'CUSTOMER_SERIES');
ALTER TABLE "customer_barcode_series" ADD CONSTRAINT "customer_barcode_series_shape_ck" CHECK (btrim("prefix") <> '' AND "digits" BETWEEN 1 AND 12 AND ("startValue" IS NULL OR "startValue" >= 0) AND ("maxValue" IS NULL OR "maxValue" >= COALESCE("startValue", 0)));
