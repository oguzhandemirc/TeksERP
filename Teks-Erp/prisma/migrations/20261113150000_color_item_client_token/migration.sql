-- V5c: renk ve ürün doğuşunda opsiyonel deneme kimliği (patron telefonu). Yalnız boş bırakılabilir kolon + unique;
-- backfill YOK (mevcut satırlar NULL kalır, unique NULL'ları çoklu kabul eder).

-- AlterTable
ALTER TABLE "colors" ADD COLUMN "clientToken" UUID;

-- AlterTable
ALTER TABLE "items" ADD COLUMN "clientToken" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "colors_clientToken_key" ON "colors"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "items_clientToken_key" ON "items"("clientToken");
