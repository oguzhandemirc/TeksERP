-- =============================================================================
-- ANA VERİ BİRLEŞTİRME SOY BAĞI (Faz B1)
-- =============================================================================
-- Mükerrer kaydı SİLMEK yerine survivor'a bağlayan tombstone kolonları.
-- Emsal: `20260715233000_batch_merged_into` (Batch.mergedIntoId).
--
-- ⚠️ TAMAMEN IDEMPOTENT yazıldı ve bu BİLİNÇLİ: geliştirme veritabanında bu
-- kolonlar migration dosyası doğmadan ÖNCE oluştu (paylaşımlı ağaç/DB — bir
-- `migrate dev` koşumu şemadaki blokları diff'e alıp doğrudan uyguladı).
-- Aynı dosya hem "kolonlar zaten var" olan dev DB'sinde hem de kolonları hiç
-- görmemiş production'da koşmak zorunda. `IF NOT EXISTS` + DO blokları bunu
-- garanti eder; `migrate resolve --applied` SQL'in koştuğunu DOĞRULAMAZ, o
-- yüzden burada tek dayanağımız dosyanın kendisinin güvenli olması.
--
-- ⚠️ Index PARTIAL: birleşmiş kayıt istisnadır (binlerce satırda bir avuç),
-- sorgu yolu daima "şu survivor'ın çocukları". Prisma predicate'i modellemez —
-- şemada düz `@@index([mergedIntoId])` durur, burada partial'a çevrilir
-- (drift-free desen; Prisma 7 predicate farkını drift SAYMAZ). Yeni satırlar
-- `scripts/test_db_invariants.ts` PARTIAL_INDEXES envanterine yazıldı.
--
-- ⚠️ FK `ON DELETE SET NULL`: Batch emsaliyle aynı. Bu tasarım hiç DELETE
-- yapmaz, ama biri ileride survivor'ı silerse tombstone'un soy bağı kopar —
-- kaydın kendisi kaybolmaz. Ters yönü (tombstone'u silmek) engelleyen şey
-- servis katmanıdır, FK değil.

-- 1) Kolonlar ------------------------------------------------------------
ALTER TABLE "customers"      ADD COLUMN IF NOT EXISTS "mergedIntoId" UUID;
ALTER TABLE "customers"      ADD COLUMN IF NOT EXISTS "mergedAt"     TIMESTAMPTZ;
ALTER TABLE "customers"      ADD COLUMN IF NOT EXISTS "mergedById"   UUID;

ALTER TABLE "items"          ADD COLUMN IF NOT EXISTS "mergedIntoId" UUID;
ALTER TABLE "items"          ADD COLUMN IF NOT EXISTS "mergedAt"     TIMESTAMPTZ;
ALTER TABLE "items"          ADD COLUMN IF NOT EXISTS "mergedById"   UUID;

ALTER TABLE "colors"         ADD COLUMN IF NOT EXISTS "mergedIntoId" UUID;
ALTER TABLE "colors"         ADD COLUMN IF NOT EXISTS "mergedAt"     TIMESTAMPTZ;
ALTER TABLE "colors"         ADD COLUMN IF NOT EXISTS "mergedById"   UUID;

ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "mergedIntoId" UUID;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "mergedAt"     TIMESTAMPTZ;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "mergedById"   UUID;

-- 2) Yabancı anahtarlar --------------------------------------------------
-- PG'de `ADD CONSTRAINT IF NOT EXISTS` yok → DO bloğu.
DO $fk$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','items','colors','subcontractors'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_mergedIntoId_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("mergedIntoId") REFERENCES %I(id) ON DELETE SET NULL ON UPDATE CASCADE',
        t, t || '_mergedIntoId_fkey', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_mergedById_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("mergedById") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE',
        t, t || '_mergedById_fkey');
    END IF;
  END LOOP;
END $fk$;

-- 3) Partial index -------------------------------------------------------
-- DROP + CREATE: dev DB'sinde Prisma bunları TAM index olarak yarattı.
DROP INDEX IF EXISTS "customers_mergedIntoId_idx";
DROP INDEX IF EXISTS "items_mergedIntoId_idx";
DROP INDEX IF EXISTS "colors_mergedIntoId_idx";
DROP INDEX IF EXISTS "subcontractors_mergedIntoId_idx";

CREATE INDEX "customers_mergedIntoId_idx"      ON "customers"("mergedIntoId")      WHERE "mergedIntoId" IS NOT NULL;
CREATE INDEX "items_mergedIntoId_idx"          ON "items"("mergedIntoId")          WHERE "mergedIntoId" IS NOT NULL;
CREATE INDEX "colors_mergedIntoId_idx"         ON "colors"("mergedIntoId")         WHERE "mergedIntoId" IS NOT NULL;
CREATE INDEX "subcontractors_mergedIntoId_idx" ON "subcontractors"("mergedIntoId") WHERE "mergedIntoId" IS NOT NULL;
