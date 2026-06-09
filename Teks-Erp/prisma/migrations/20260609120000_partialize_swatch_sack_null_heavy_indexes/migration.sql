-- Null-yoğun swatches/sacks FK indekslerini PARTIAL'a çevir (WHERE col IS NOT NULL).
-- Aynı gerekçe + yöntem rolls migration'ı 20260606001717 ile birebir: bu lifecycle
-- FK'leri (parentReceiptId/shipmentId/sackId) kayıtların çoğunda NULL'dır (kartela
-- sevk/sevkiyat/çuval bağı yapılana dek). Tam B-tree null'ları da indeksler →
-- gereksiz şişme + her insert'te bakım. Partial yalnız dolu satırları indeksler,
-- null insert'lerde indeks bakımı SIFIR. İlgili sorgular zaten "IS NOT NULL"/eşitlik
-- arar → kapsama korunur. (Prisma 7 partial'ı şemada native desteklemez → raw SQL;
-- @@index satırları şemada KALIR, Prisma 7 partial predicate'i drift saymaz.)
-- Büyük tabloda statement_timeout=30s DDL'i kesebilir → en başta sıfırla.

SET statement_timeout = 0;

DROP INDEX IF EXISTS "swatches_parentReceiptId_idx";
CREATE INDEX "swatches_parentReceiptId_idx" ON "swatches" ("parentReceiptId") WHERE "parentReceiptId" IS NOT NULL;

DROP INDEX IF EXISTS "swatches_shipmentId_idx";
CREATE INDEX "swatches_shipmentId_idx" ON "swatches" ("shipmentId") WHERE "shipmentId" IS NOT NULL;

DROP INDEX IF EXISTS "swatches_sackId_idx";
CREATE INDEX "swatches_sackId_idx" ON "swatches" ("sackId") WHERE "sackId" IS NOT NULL;

DROP INDEX IF EXISTS "sacks_shipmentId_idx";
CREATE INDEX "sacks_shipmentId_idx" ON "sacks" ("shipmentId") WHERE "shipmentId" IS NOT NULL;
