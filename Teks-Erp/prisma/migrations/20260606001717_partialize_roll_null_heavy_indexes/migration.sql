-- Null-yoğun rolls FK indekslerini PARTIAL'a çevir (WHERE col IS NOT NULL).
-- Bu kolonlar satırların %75-95'inde NULL; tam B-tree null'ları da indeksler →
-- gereksiz şişme + her insert'te bakım. Partial: yalnız dolu satırları indeksler,
-- null insert'lerde indeks bakımı SIFIR. İlgili sorgular zaten "IS NOT NULL"/eşitlik
-- arar, kapsama korunur. (Prisma 7 partial'ı şemada native desteklemez → raw SQL.)
-- Ölçüldü (300k): FULL→LEAN insert %20 hızlı, indeks boyutu %14 küçük.

DROP INDEX IF EXISTS "rolls_sackId_idx";
CREATE INDEX "rolls_sackId_idx" ON "rolls" ("sackId") WHERE "sackId" IS NOT NULL;

DROP INDEX IF EXISTS "rolls_shipmentId_idx";
CREATE INDEX "rolls_shipmentId_idx" ON "rolls" ("shipmentId") WHERE "shipmentId" IS NOT NULL;

DROP INDEX IF EXISTS "rolls_parentReceiptId_idx";
CREATE INDEX "rolls_parentReceiptId_idx" ON "rolls" ("parentReceiptId") WHERE "parentReceiptId" IS NOT NULL;

DROP INDEX IF EXISTS "rolls_batchSplitId_idx";
CREATE INDEX "rolls_batchSplitId_idx" ON "rolls" ("batchSplitId") WHERE "batchSplitId" IS NOT NULL;
