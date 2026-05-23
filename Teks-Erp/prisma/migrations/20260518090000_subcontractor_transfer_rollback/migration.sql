-- =============================================================================
-- ROLLBACK: subcontractor_transfer
-- =============================================================================
-- Önceki "subcontractor_transfer" planı çok karmaşık çıktı; kategoriye yapışık
-- returnsOpenFabric bayrağı + Transfer modeli yerine sadeleştirme yaptık.
-- Bu migration o değişiklikleri geri alır:
--   - 4 transfer tablosu drop
--   - rolls.sourceTransferId drop + index
--   - subcontractor_categories.returnsOpenFabric drop
--   - RollOperationType.SUBCONTRACTOR_TRANSFERRED enum value drop
-- =============================================================================

-- DropForeignKey'ler (cascade'lı child'lar önce; parent FK'lar sonra)
ALTER TABLE "subcontractor_transfer_properties" DROP CONSTRAINT IF EXISTS "subcontractor_transfer_properties_propertyId_fkey";
ALTER TABLE "subcontractor_transfer_properties" DROP CONSTRAINT IF EXISTS "subcontractor_transfer_properties_transferId_fkey";
ALTER TABLE "subcontractor_transfer_consumed" DROP CONSTRAINT IF EXISTS "subcontractor_transfer_consumed_rollId_fkey";
ALTER TABLE "subcontractor_transfer_consumed" DROP CONSTRAINT IF EXISTS "subcontractor_transfer_consumed_transferId_fkey";
ALTER TABLE "subcontractor_transfer_items" DROP CONSTRAINT IF EXISTS "subcontractor_transfer_items_newRollId_fkey";
ALTER TABLE "subcontractor_transfer_items" DROP CONSTRAINT IF EXISTS "subcontractor_transfer_items_transferId_fkey";
ALTER TABLE "rolls" DROP CONSTRAINT IF EXISTS "rolls_sourceTransferId_fkey";
ALTER TABLE "subcontractor_transfers" DROP CONSTRAINT IF EXISTS "subcontractor_transfers_cancelledById_fkey";
ALTER TABLE "subcontractor_transfers" DROP CONSTRAINT IF EXISTS "subcontractor_transfers_transferredById_fkey";
ALTER TABLE "subcontractor_transfers" DROP CONSTRAINT IF EXISTS "subcontractor_transfers_appliedColorId_fkey";
ALTER TABLE "subcontractor_transfers" DROP CONSTRAINT IF EXISTS "subcontractor_transfers_toSubcontractorId_fkey";
ALTER TABLE "subcontractor_transfers" DROP CONSTRAINT IF EXISTS "subcontractor_transfers_fromSubcontractorId_fkey";
ALTER TABLE "subcontractor_transfers" DROP CONSTRAINT IF EXISTS "subcontractor_transfers_toStepId_fkey";
ALTER TABLE "subcontractor_transfers" DROP CONSTRAINT IF EXISTS "subcontractor_transfers_fromStepId_fkey";
ALTER TABLE "subcontractor_transfers" DROP CONSTRAINT IF EXISTS "subcontractor_transfers_workOrderId_fkey";

-- DropTable'lar
DROP TABLE IF EXISTS "subcontractor_transfer_properties";
DROP TABLE IF EXISTS "subcontractor_transfer_consumed";
DROP TABLE IF EXISTS "subcontractor_transfer_items";
DROP TABLE IF EXISTS "subcontractor_transfers";

-- Roll'dan sourceTransferId kolonunu çıkar
DROP INDEX IF EXISTS "rolls_sourceTransferId_idx";
ALTER TABLE "rolls" DROP COLUMN IF EXISTS "sourceTransferId";

-- Kategorilerden returnsOpenFabric bayrağını çıkar (3 satırdaki veri kaybolur, kasıtlı)
ALTER TABLE "subcontractor_categories" DROP COLUMN IF EXISTS "returnsOpenFabric";

-- Enum değerini güvenli şekilde sil:
-- PostgreSQL'de doğrudan enum value kaldırma desteklenmiyor — yeni enum oluştur,
-- ilgili kolonları cast et, eski enum'u drop et.
-- Bu enum sadece roll_operations.operationType ve role_permissions yok bağımlısı,
-- yalnızca roll_operations.operationType kullanıyor.
ALTER TYPE "RollOperationType" RENAME TO "RollOperationType_old";

CREATE TYPE "RollOperationType" AS ENUM (
  'KURSUN_APPLIED',
  'QC2_COMPLETED',
  'TAMBUR_PROCESSED',
  'PACKAGED',
  'SUBCONTRACTOR_SENT',
  'SUBCONTRACTOR_RETURNED'
);

ALTER TABLE "roll_operations"
  ALTER COLUMN "operationType" TYPE "RollOperationType"
  USING ("operationType"::text::"RollOperationType");

DROP TYPE "RollOperationType_old";
