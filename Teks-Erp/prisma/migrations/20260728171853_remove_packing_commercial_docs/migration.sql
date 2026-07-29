-- PACKING_LIST + COMMERCIAL_INVOICE belgeleri kaldırıldı (kod + Prisma enum).
-- Postgres enum'dan değer silmek = tipi yeniden yarat. Bu iki docType'ta kayıt yok
-- (doğrulandı); DELETE savunmacı no-op. Yalnız printed_documents.docType bu enum'u kullanır.
DELETE FROM "printed_documents" WHERE "docType" IN ('PACKING_LIST', 'COMMERCIAL_INVOICE');

ALTER TYPE "PrintedDocType" RENAME TO "PrintedDocType_old";
CREATE TYPE "PrintedDocType" AS ENUM ('SHIPMENT_DISPATCH', 'SUBCONTRACTOR_DISPATCH', 'KARTELA_DISPATCH', 'SUBCONTRACTOR_DIRECT_SHIP', 'SUBCONTRACTOR_RECEIPT', 'QUALITY_CERTIFICATE', 'RETURN_DISPATCH');
ALTER TABLE "printed_documents" ALTER COLUMN "docType" TYPE "PrintedDocType" USING ("docType"::text::"PrintedDocType");
DROP TYPE "PrintedDocType_old";
