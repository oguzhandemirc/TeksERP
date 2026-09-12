-- ===========================================================================
-- ③ İÇE AKTARIM GERİ SARMA DEFTERİ — `import_run_lines` + koşum damgaları
-- Sözleşme: docs/design/IMPORT-EXPORT-TASARIM.md §8
-- ===========================================================================
-- NEDEN: bir koşumun YAZDIĞI kayıtların izi bugün yalnız audit'te duruyor
-- (`system_logs`, `newData.importRunId`, 6 ayda arşivlenir) ve motorun audit
-- satırında `oldData` YOK. İş kararına giren bilgi KALICI kolonda durmalı.
--
-- Bant sırası: ad, dizindeki en son migration'dan BÜYÜK olmak ZORUNDA (Prisma
-- uygulama sırası ad tabanlı). Bu bant elle tahsiste üç kez kaydı
-- (130200 → 160000 → 160200); aynı commit'te `test_migration_hygiene.ts`e
-- monotonluk kapısı eklendi.
--
-- İdempotent yazıldı: `--apply` ikinci kez koşarsa (defter satırı varken SQL
-- tekrar çalıştırılırsa) hata vermez.
-- ===========================================================================

-- CreateEnum (CREATE TYPE'ın IF NOT EXISTS'i yok → DO bloğu)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImportLineAction') THEN
    CREATE TYPE "ImportLineAction" AS ENUM ('CREATE', 'UPDATE', 'REVIVE');
  END IF;
END
$$;

-- AlterTable: koşuma geri sarma damgası (ileri kayıt silinmez/değişmez)
ALTER TABLE "import_runs"
  ADD COLUMN IF NOT EXISTS "revertedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "revertedById" UUID,
  ADD COLUMN IF NOT EXISTS "revertReason" VARCHAR(500);

-- CreateTable: satır defteri (append-only → `updatedAt` YOK)
CREATE TABLE IF NOT EXISTS "import_run_lines" (
  "id" UUID NOT NULL,
  "importRunId" UUID NOT NULL,
  "entity" VARCHAR(40) NOT NULL,
  "tableName" VARCHAR(63) NOT NULL,
  "recordId" UUID NOT NULL,
  "rowNo" INTEGER NOT NULL,
  "rowNos" JSONB,
  "keyValue" VARCHAR(120),
  "label" VARCHAR(200),
  "action" "ImportLineAction" NOT NULL,
  "changedFields" JSONB,
  "childSnapshot" JSONB,
  "sideEffects" JSONB,
  "revertedAt" TIMESTAMPTZ,
  "revertedById" UUID,
  "revertSkipReason" VARCHAR(300),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_run_lines_pkey" PRIMARY KEY ("id")
);

-- Index: koşum dökümü (satır sırasıyla) · kayıt bazlı arama · ters yol araması
CREATE INDEX IF NOT EXISTS "import_run_lines_importRunId_rowNo_idx"
  ON "import_run_lines" ("importRunId", "rowNo");
CREATE INDEX IF NOT EXISTS "import_run_lines_entity_recordId_idx"
  ON "import_run_lines" ("entity", "recordId");
CREATE INDEX IF NOT EXISTS "import_run_lines_recordId_idx"
  ON "import_run_lines" ("recordId");

-- FK: RESTRICT — koşum satırı silinemez (defter bağı kopmasın)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'import_run_lines_importRunId_fkey'
  ) THEN
    ALTER TABLE "import_run_lines"
      ADD CONSTRAINT "import_run_lines_importRunId_fkey"
      FOREIGN KEY ("importRunId") REFERENCES "import_runs"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
