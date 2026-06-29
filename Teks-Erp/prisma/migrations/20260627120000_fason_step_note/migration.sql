-- Fason istasyon notu → o adımın çeki listesine.
-- Global WorkOrder.dyehouseNote kaldırıldı; per-adım WorkOrderStep.notes tek kaynak.
-- SubcontractorDispatch.dyehouseNote → instruction (artık boyahaneye özgü değil, genel
-- fason talimatı; default kaynağı sevk edilen adımın notu).

ALTER TABLE "work_orders" DROP COLUMN "dyehouseNote";
ALTER TABLE "subcontractor_dispatches" RENAME COLUMN "dyehouseNote" TO "instruction";
