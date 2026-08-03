-- NOT: `migrate dev` bu diff'in başına iki DropForeignKey satırı üretti
-- (rolls/swatches _sackId_shipmentId_consistency_fkey) ve BİLİNÇLİ olarak silindi —
-- bu composite FK'lar datamodel'de temsil edilemediği için her diff'te düşürülmek
-- istenir. Bkz. schema.prisma:2557-2558 + Teks-Erp/CLAUDE.md perf kuralı 4.

-- AlterTable
ALTER TABLE "direct_shipments" ADD COLUMN     "invoiceNo" VARCHAR(64),
ADD COLUMN     "invoicedAt" TIMESTAMPTZ,
ADD COLUMN     "invoicedById" UUID;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "invoiceNo" VARCHAR(64),
ADD COLUMN     "invoicedAt" TIMESTAMPTZ,
ADD COLUMN     "invoicedById" UUID;

-- CreateIndex
CREATE INDEX "shipments_status_dispatchedAt_idx" ON "shipments"("status", "dispatchedAt");

-- AddForeignKey
ALTER TABLE "direct_shipments" ADD CONSTRAINT "direct_shipments_invoicedById_fkey" FOREIGN KEY ("invoicedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_invoicedById_fkey" FOREIGN KEY ("invoicedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
