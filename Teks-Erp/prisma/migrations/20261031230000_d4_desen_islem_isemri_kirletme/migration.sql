-- D4-MIG6 — Dalga 4 artıkları (D4-D3 #323 + D4-J5 #321 kalanları). Şema (schema.prisma) değişmez:
-- yalnız CHECK genişletmesi + bulut eşitleme tetikleyicileri. Geçmiş satırlara dokunulmaz (toplu UPDATE yok).

-- (1) Dış brode kabulünde fiilî desen `RollOperation.propertyValueId`ye de yazılır (DALGA4 §5.4): değer
--     artık SUBCONTRACTOR_RETURNED satırında da geçerli; QC2/tambur/fasona sevk satırında hâlâ yasak.
ALTER TABLE "roll_operations" DROP CONSTRAINT IF EXISTS "roll_operations_property_value_ck";
ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_property_value_ck"
  CHECK ("propertyValueId" IS NULL OR "operationType" IN ('KURSUN_APPLIED', 'SUBCONTRACTOR_RETURNED'));

-- (2) Patron bulutu `is-emri.sevkeHazir` bayatlığı: top başka partiye geçince ESKİ partinin iş emri KIRLI
--     (yeni parti tarafı topun filigranından görünür — `WO_OF_ROLLS` parti kolu).
CREATE OR REPLACE FUNCTION sync_mark_roll_old_parents() RETURNS trigger LANGUAGE plpgsql AS $sync_mark_roll_old_parents$
DECLARE
  wo uuid;
BEGIN
  IF OLD."sackId" IS NOT NULL AND OLD."sackId" IS DISTINCT FROM NEW."sackId" THEN
    INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('sacks', OLD."sackId", 'DIRTY');
  END IF;
  IF OLD."shipmentId" IS NOT NULL AND OLD."shipmentId" IS DISTINCT FROM NEW."shipmentId" THEN
    INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('shipments', OLD."shipmentId", 'DIRTY');
  END IF;
  IF OLD."currentStepId" IS NOT NULL AND OLD."currentStepId" IS DISTINCT FROM NEW."currentStepId" THEN
    SELECT s."workOrderId" INTO wo FROM "work_order_steps" s WHERE s."id" = OLD."currentStepId";
    IF wo IS NOT NULL THEN
      INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('work_orders', wo, 'DIRTY');
    END IF;
  END IF;
  IF OLD."producedInStepId" IS NOT NULL AND OLD."producedInStepId" IS DISTINCT FROM NEW."producedInStepId" THEN
    SELECT s."workOrderId" INTO wo FROM "work_order_steps" s WHERE s."id" = OLD."producedInStepId";
    IF wo IS NOT NULL THEN
      INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('work_orders', wo, 'DIRTY');
    END IF;
  END IF;
  IF OLD."batchId" IS NOT NULL AND OLD."batchId" IS DISTINCT FROM NEW."batchId" THEN
    SELECT b."workOrderId" INTO wo FROM "batches" b WHERE b."id" = OLD."batchId";
    IF wo IS NOT NULL THEN
      INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('work_orders', wo, 'DIRTY');
    END IF;
  END IF;
  RETURN NULL;
END
$sync_mark_roll_old_parents$;

DROP TRIGGER IF EXISTS "rolls_sync_parent_moved" ON "rolls";
CREATE TRIGGER "rolls_sync_parent_moved" AFTER UPDATE OF "sackId", "shipmentId", "currentStepId", "producedInStepId", "batchId" ON "rolls"
  FOR EACH ROW WHEN (OLD."sackId" IS DISTINCT FROM NEW."sackId" OR OLD."shipmentId" IS DISTINCT FROM NEW."shipmentId"
                  OR OLD."currentStepId" IS DISTINCT FROM NEW."currentStepId" OR OLD."producedInStepId" IS DISTINCT FROM NEW."producedInStepId"
                  OR OLD."batchId" IS DISTINCT FROM NEW."batchId")
  EXECUTE FUNCTION sync_mark_roll_old_parents();

-- (3) Parti başka iş emrine taşınınca toplar değişmez (filigran yok) → ESKİ ve YENİ iş emri KIRLI.
CREATE OR REPLACE FUNCTION sync_mark_batch_work_order_moved() RETURNS trigger LANGUAGE plpgsql AS $sync_mark_batch_work_order_moved$
BEGIN
  IF OLD."workOrderId" IS DISTINCT FROM NEW."workOrderId" THEN
    IF OLD."workOrderId" IS NOT NULL THEN
      INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('work_orders', OLD."workOrderId", 'DIRTY');
    END IF;
    IF NEW."workOrderId" IS NOT NULL THEN
      INSERT INTO "sync_marks" ("tableName", "rowId", "kind") VALUES ('work_orders', NEW."workOrderId", 'DIRTY');
    END IF;
  END IF;
  RETURN NULL;
END
$sync_mark_batch_work_order_moved$;

DROP TRIGGER IF EXISTS "batches_sync_wo_moved" ON "batches";
CREATE TRIGGER "batches_sync_wo_moved" AFTER UPDATE OF "workOrderId" ON "batches"
  FOR EACH ROW WHEN (OLD."workOrderId" IS DISTINCT FROM NEW."workOrderId")
  EXECUTE FUNCTION sync_mark_batch_work_order_moved();
