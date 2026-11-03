-- S3 (fabrika cevabı 14, 2026-11-03): müşteriye özel varsayılan kurşun gramajı (NULL = istasyon varsayılanı, bugünkü).

-- AlterTable
ALTER TABLE "cari_accounts" ADD COLUMN     "kursunDefaultValueId" UUID;

-- CreateIndex
CREATE INDEX "cari_accounts_kursunDefaultValueId_idx" ON "cari_accounts"("kursunDefaultValueId");

-- AddForeignKey
ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_kursunDefaultValueId_fkey" FOREIGN KEY ("kursunDefaultValueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
