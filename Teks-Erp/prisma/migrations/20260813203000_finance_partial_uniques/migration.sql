-- Ön muhasebe: nullable unique'ler PARTIAL'a çevrilir.
--
-- NEDEN: Prisma `@unique`'i nullable kolonda TAM unique index olarak yaratır.
-- Postgres'te uniqueness semantiği aynıdır (birden çok NULL zaten çakışmaz),
-- kazanç index BOYUTUDUR — NULL satırlar indekse hiç girmez. Projenin yerleşik
-- konvansiyonu bu (`orders_clientToken_key`, `warehouse_transfers_clientToken_key`,
-- `goods_receipts_clientToken_key` üçü de partial) ve tutarlılık ucuz.
--
-- ⚠️ DRIFT-FREE YÖNTEM (perf kuralı 4): şemada `@unique` AYNEN kalır, burada
-- DROP + CREATE ... WHERE yapılır. Prisma 7 PREDICATE farkını drift SAYMAZ ama
-- index↔unique farkını SAYAR — bu yüzden partial UNIQUE için şemada `@unique`
-- kullanmak zorunludur, `@@index` değil.
--
-- Hepsi `scripts/test_db_invariants.ts` envanterine yazılmıştır.

DROP INDEX "invoices_clientToken_key";
CREATE UNIQUE INDEX "invoices_clientToken_key"
  ON "invoices" ("clientToken") WHERE ("clientToken" IS NOT NULL);

DROP INDEX "payments_clientToken_key";
CREATE UNIQUE INDEX "payments_clientToken_key"
  ON "payments" ("clientToken") WHERE ("clientToken" IS NOT NULL);

-- Cari tarafında NULL YOĞUNLUĞU yapısaldır: müşteri carilerinde
-- `subcontractorId`, fason carilerinde `customerId` daima NULL'dır — yani her
-- iki indeksin de yarısı tanım gereği boş satırdan oluşurdu.
DROP INDEX "cari_accounts_customerId_key";
CREATE UNIQUE INDEX "cari_accounts_customerId_key"
  ON "cari_accounts" ("customerId") WHERE ("customerId" IS NOT NULL);

DROP INDEX "cari_accounts_subcontractorId_key";
CREATE UNIQUE INDEX "cari_accounts_subcontractorId_key"
  ON "cari_accounts" ("subcontractorId") WHERE ("subcontractorId" IS NOT NULL);
