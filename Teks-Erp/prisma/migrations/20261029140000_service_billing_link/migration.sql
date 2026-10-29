-- H7 (Hizmet veren, 2026-10-29) M3: hizmet işi ↔ fatura bağı (ServiceBillingLink) + ServiceMeterBasis.
-- ADDITIVE: yeni tablo + enum; mevcut satıra dokunmaz. --create-only; DropForeignKey satırları silindi.
-- Resmi/gayri resmi kolonları (Invoice.official, CariAccount.defaultOfficial) BU migration'da YOK (karar bekliyor).
-- CreateEnum
CREATE TYPE "ServiceMeterBasis" AS ENUM ('OUT', 'IN', 'DECLARED', 'CUT', 'RECEIVED');

-- CreateTable
CREATE TABLE "service_billing_links" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "workOrderStepId" UUID,
    "serviceItemId" UUID NOT NULL,
    "readingId" UUID,
    "billedMeters" DECIMAL(12,3) NOT NULL,
    "meterBasis" "ServiceMeterBasis" NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "serviceAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "service_billing_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_billing_links_invoiceId_idx" ON "service_billing_links"("invoiceId");

-- CreateIndex
CREATE INDEX "service_billing_links_rollId_revokedAt_idx" ON "service_billing_links"("rollId", "revokedAt");

-- CreateIndex
CREATE INDEX "service_billing_links_workOrderStepId_idx" ON "service_billing_links"("workOrderStepId");

-- CreateIndex
CREATE INDEX "service_billing_links_serviceItemId_idx" ON "service_billing_links"("serviceItemId");

-- CreateIndex
CREATE INDEX "service_billing_links_readingId_idx" ON "service_billing_links"("readingId");

-- AddForeignKey
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_workOrderStepId_fkey" FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "roll_meter_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- İş başına TEK aktif bağ: adımsız (NULL) iş de tekil olsun diye NULLS NOT DISTINCT (PG 15+; CI 16).
-- Damgalı (iptal edilmiş faturanın) bağı yer işgal etmez → iş yeniden faturalanabilir. Tablo boş doğar.
CREATE UNIQUE INDEX IF NOT EXISTS "service_billing_links_active_uq"
  ON "service_billing_links"("rollId", "serviceItemId", "workOrderStepId") NULLS NOT DISTINCT WHERE "revokedAt" IS NULL;
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_meters_ck" CHECK ("billedMeters" >= 0);
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_revoke_ck" CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL));
