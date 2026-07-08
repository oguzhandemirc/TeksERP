-- Worklist Faz 10 — F4-kalan (WorkOrderToOrderLine.updatedAt) + F188 (label default seddi)
SET statement_timeout = 0;

-- F4-kalan: WorkOrderToOrderLine PIVOT DEĞİL (allocatedQty mutable) → updatedAt hak ediyor.
-- (Session/RollMovement/RollReturn zaten Faz 6/O-10'da yapıldı; SystemLog.updatedAt kaldırma
--  audit.service:193 coupling'i + düşük değer nedeniyle ertelendi.)
ALTER TABLE "work_order_to_order_lines" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "work_order_to_order_lines" SET "updatedAt" = "createdAt";
ALTER TABLE "work_order_to_order_lines" ALTER COLUMN "updatedAt" SET NOT NULL;

-- F188: 'kind başına tek isDefault' partial unique GERİ KOY. migration 20260706090000 düşürmüştü;
-- gerçek default LabelContextDefault'ta ama isDefault hâlâ yazılıyor → DB seddi geri gelsin.
-- Pre-flight: çift-default = 0. label-template.service:rethrowDefaultConflict index adındaki
-- 'default'ı yakalar (P2002) — o app-code'a DOKUNULMADI. roll_movements_one_open emsali (raw-SQL).
CREATE UNIQUE INDEX "label_templates_one_default_per_kind" ON "label_templates" ("kind") WHERE "isDefault" = true;
