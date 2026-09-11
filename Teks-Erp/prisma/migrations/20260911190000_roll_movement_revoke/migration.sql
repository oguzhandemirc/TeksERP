-- =============================================================================
-- `RollMovement` geri alınırken SİLİNMİYOR, damgalanıyor (defter doktrini B-4b)
-- =============================================================================
-- Kod DÖRT yerde `deleteMany` ile hareket siliyordu (manuel taşıma, fason kabul
-- iptali, fason aktarım geri alma, kurşun/QC2 yeniden açma): topun hangi adıma
-- girdiği sorusunun cevabı geriye dönük DEĞİŞİYORDU.
--
-- ⚠️ KRİTİK: şema-dışı partial unique `roll_movements_one_open_per_roll_step_uq`
-- ("bir top bir adımda en fazla BİR açık movement") geri alınmış AÇIK satırı da
-- sayardı → top o adıma bir daha GİREMEZDİ. Predicate'e `"revokedAt" IS NULL`
-- eklenir. Bu Prisma'nın `@@unique`i DEĞİL, ham SQL ile kurulmuş bir UNIQUE
-- INDEX'tir (migration 20260612101000) → takas `DROP INDEX` ile yapılır.
--
-- SED KESİNTİSİZ: yeni index geçici adla kurulur, sonra eskisi düşer ve ad
-- devralınır. IF [NOT] EXISTS'ler yarıda kalan koşumun yeniden koşulabilmesi için.
--
-- GÜVENLİ: üç NULLABLE kolon. Mevcut satırların hepsi `revokedAt IS NULL` doğar,
-- yani yeni predicate bugünkü kümeyi AYNEN korur — index kurulumu mükerrere
-- düşemez, davranış değişmez.
-- =============================================================================

ALTER TABLE "roll_movements" ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ;
ALTER TABLE "roll_movements" ADD COLUMN IF NOT EXISTS "revokedById"  UUID;
ALTER TABLE "roll_movements" ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);

CREATE UNIQUE INDEX IF NOT EXISTS "roll_movements_one_open_per_roll_step_uq_new"
  ON "roll_movements" ("rollId", "workOrderStepId")
  WHERE "exitedAt" IS NULL AND "revokedAt" IS NULL;

DROP INDEX IF EXISTS "roll_movements_one_open_per_roll_step_uq";

ALTER INDEX IF EXISTS "roll_movements_one_open_per_roll_step_uq_new"
  RENAME TO "roll_movements_one_open_per_roll_step_uq";

-- Geri alınmış satır aktif okumalarda süzülür; top bazlı okumalar iki kolonla daralsın.
CREATE INDEX IF NOT EXISTS "roll_movements_rollId_revokedAt_idx"
  ON "roll_movements" ("rollId", "revokedAt");
