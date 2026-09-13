-- ③a TİCARİ PİVOT: topun ve iş emrinin özelliği sil-yazdan sürümlemeye geçti
-- (OZELLIK-PIVOT-SURUMLEME-PLAN §6, 2026-09-14). Üç nullable kolon + partial unique takası.
-- ⚠️ Prisma'nın @@unique'i CONSTRAINT değil INDEX üretir → DROP INDEX (B-4a dersi:
--    DROP CONSTRAINT IF EXISTS sessizce no-op olur).
-- ⚠️ "Atomik" DEĞİL, "yeniden koşulabilir": apply-migration psql'i --single-transaction'sız
--    çağırır; CREATE-önce/DROP-sonra + IF [NOT] EXISTS yarıda kalan koşumu tekrar koşulabilir
--    bırakır. `SET lock_timeout`: DROP INDEX ACCESS EXCLUSIVE ister, kuyrukta bekleyip
--    tabloyu kilitlemesin.
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA
--    DÜŞÜRÜLMEZ. BACKFILL YOK: mevcut satırların hepsi aktif doğar.

SET lock_timeout = '3s';

ALTER TABLE "roll_properties" ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ;
ALTER TABLE "roll_properties" ADD COLUMN IF NOT EXISTS "revokedById"  UUID;
ALTER TABLE "roll_properties" ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);
CREATE UNIQUE INDEX IF NOT EXISTS "roll_properties_active_pair_uq"
  ON "roll_properties" ("rollId", "propertyId") WHERE "revokedAt" IS NULL;
DROP INDEX IF EXISTS "roll_properties_rollId_propertyId_key";
CREATE INDEX IF NOT EXISTS "roll_properties_rollId_revokedAt_idx"
  ON "roll_properties" ("rollId", "revokedAt");

ALTER TABLE "work_order_target_properties" ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ;
ALTER TABLE "work_order_target_properties" ADD COLUMN IF NOT EXISTS "revokedById"  UUID;
ALTER TABLE "work_order_target_properties" ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_target_properties_active_pair_uq"
  ON "work_order_target_properties" ("workOrderId", "propertyId") WHERE "revokedAt" IS NULL;
DROP INDEX IF EXISTS "work_order_target_properties_workOrderId_propertyId_key";
CREATE INDEX IF NOT EXISTS "work_order_target_properties_workOrderId_revokedAt_idx"
  ON "work_order_target_properties" ("workOrderId", "revokedAt");
