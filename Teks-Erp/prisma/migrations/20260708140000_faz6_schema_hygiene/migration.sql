-- Faz 6 — Şema hijyeni (veritabani mimari denetimi bulgulari)
-- O-9 (dyehouseNote ölü/drift kolon), O-10 (updatedAt konvansiyon ihlali), D-14 (UUID tip).
SET statement_timeout = 0;

-- ============================================================================
-- O-9: dyehouseNote temizliği
--   work_orders.dyehouseNote: bilinçli DROP edilmiş, drift-fix migration'ıyla yanlışlıkla
--     geri gelmiş; kod hiç kullanmıyor (tek kaynak WorkOrderStep.notes).
--   subcontractor_dispatches.dyehouseNote: şema-dışı DRIFT kolonu (şemada 'instruction'
--     olarak yaşıyor); dev DB'de kalıntı olarak duruyor.
-- ============================================================================
ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "dyehouseNote";
ALTER TABLE "subcontractor_dispatches" DROP COLUMN IF EXISTS "dyehouseNote";

-- ============================================================================
-- O-10: mutasyona uğrayan 3 tabloya updatedAt. Prisma @updatedAt kolonu DB'de
-- NOT NULL + default'suz (mevcut kolon deseniyle birebir). Var olan satırlar
-- createdAt ile backfill edilir; sonra NOT NULL'a çekilir.
-- ============================================================================
ALTER TABLE "sessions" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "sessions" SET "updatedAt" = "createdAt";
ALTER TABLE "sessions" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "roll_movements" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "roll_movements" SET "updatedAt" = "createdAt";
ALTER TABLE "roll_movements" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "roll_returns" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "roll_returns" SET "updatedAt" = "createdAt";
ALTER TABLE "roll_returns" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ============================================================================
-- D-14: UUID taşıyan 4 text kolonu uuid tipine. FK EKLENMEZ — 'gevşek referans'
-- kararı korunur; yalnız tip güvenliği + 16 byte (text-UUID 36+ byte). Pre-flight:
-- geçersiz-UUID = 0 (hepsi NULL veya geçerli UUID). Indexli kolonlar (batchSplitId
-- partial, sourceId composite) ALTER TYPE ile otomatik rebuild olur.
-- ============================================================================
ALTER TABLE "rolls"             ALTER COLUMN "batchSplitId"       TYPE UUID USING "batchSplitId"::uuid;
ALTER TABLE "printed_documents" ALTER COLUMN "sourceId"           TYPE UUID USING "sourceId"::uuid;
ALTER TABLE "roll_returns"      ALTER COLUMN "prevSackId"         TYPE UUID USING "prevSackId"::uuid;
ALTER TABLE "roll_returns"      ALTER COLUMN "prevQualityGradeId" TYPE UUID USING "prevQualityGradeId"::uuid;
