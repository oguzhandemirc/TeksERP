-- K28 belge fotoğrafı saklama (Gülkesim S13b): tarama baytı küçültülebilir/silinebilir, SATIR kalır.
-- Yeni tip bu dosyada DOĞUYOR → CREATE TYPE ile kullanımı aynı dosyada serbest (RECETELER § enum).
-- Mevcut satırlar FULL doğar (bugünkü davranış); hiçbir bayt değişmez.

-- CreateEnum
CREATE TYPE "DocumentScanContentState" AS ENUM ('FULL', 'REDUCED', 'PURGED');

-- AlterTable
ALTER TABLE "document_scans" ADD COLUMN     "contentState" "DocumentScanContentState" NOT NULL DEFAULT 'FULL',
ADD COLUMN     "contentStateAt" TIMESTAMPTZ,
ALTER COLUMN "content" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "document_scans_contentState_noteId_idx" ON "document_scans"("contentState", "noteId");

-- CHECK (yeniden): sizeBytes yüklenen boydur (künye). TAM'da bayt = sizeBytes; KÜÇÜK'te 1..sizeBytes; SİLİNDİ'de bayt yok.
-- COALESCE: NULL bayt ile `octet_length` NULL döner ve CHECK'i sessizce geçirirdi.
ALTER TABLE "document_scans" DROP CONSTRAINT IF EXISTS "document_scans_size_ck";
ALTER TABLE "document_scans" ADD CONSTRAINT "document_scans_size_ck"
  CHECK ("sizeBytes" BETWEEN 1 AND 5242880 AND COALESCE(CASE "contentState"
    WHEN 'FULL' THEN octet_length("content") = "sizeBytes"
    WHEN 'REDUCED' THEN octet_length("content") BETWEEN 1 AND "sizeBytes"
    ELSE "content" IS NULL END, false));

-- CHECK: SİLİNDİ ⇔ content NULL; geçiş zamanı yalnız TAM dışında (ve orada zorunlu).
ALTER TABLE "document_scans" ADD CONSTRAINT "document_scans_content_state_ck"
  CHECK (("contentState" = 'PURGED') = ("content" IS NULL)
     AND ("contentState" = 'FULL') = ("contentStateAt" IS NULL));
