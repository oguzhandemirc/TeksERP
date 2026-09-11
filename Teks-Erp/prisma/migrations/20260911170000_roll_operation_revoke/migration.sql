-- =============================================================================
-- `RollOperation` geri alınırken SİLİNMİYOR, damgalanıyor (defter doktrini B-4a)
-- =============================================================================
-- Şema başlığı append-only diyordu, kod YEDİ yerde `deleteMany` ile siliyordu:
-- "bu topa kurşun uygulandı mı / QC2'den geçti mi / fasona gitti mi" sorusunun
-- cevabı geriye dönük DEĞİŞİYORDU — izlenebilirlik iddiası çürüktü.
--
-- ⚠️ KRİTİK VE ATLANMASI KOLAY: `@@unique([rollId, workOrderStepId,
-- operationType])` tam kısıttı. Geri alınmış satır dururken aynı üçlü yeniden
-- yazılamaz (top adımı YENİDEN işleyemez) → kısıt PARTIAL'a çevrilir:
-- `WHERE "revokedAt" IS NULL`. Şemada `@@unique` olarak KALIR (index↔unique
-- farkı drift sayılır, predicate sayılmaz — DB kuralı 3) ve
-- `test_db_invariants.ts` EXPRESSION_UNIQUES envanterine yazılır ([DB-30]).
--
-- GÜVENLİ: üç NULLABLE kolon + kısıt takası. Mevcut satırların hepsi
-- `revokedAt IS NULL` (aktif) doğar, yani partial kısıt bugünkü tam kısıtla
-- AYNI kümeyi korur — davranış değişmez.
-- =============================================================================

ALTER TABLE "roll_operations" ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ;
ALTER TABLE "roll_operations" ADD COLUMN IF NOT EXISTS "revokedById"  UUID;
ALTER TABLE "roll_operations" ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);

ALTER TABLE "roll_operations"
  DROP CONSTRAINT IF EXISTS "roll_operations_rollId_workOrderStepId_operationType_key";

CREATE UNIQUE INDEX IF NOT EXISTS "roll_operations_active_triple_uq"
  ON "roll_operations" ("rollId", "workOrderStepId", "operationType")
  WHERE "revokedAt" IS NULL;

-- Geri alınmış satır listelerde süzülür; aktif okumalar iki kolonla daralsın.
CREATE INDEX IF NOT EXISTS "roll_operations_rollId_revokedAt_idx"
  ON "roll_operations" ("rollId", "revokedAt");
