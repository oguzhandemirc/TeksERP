-- =============================================================================
-- Depo defteri STOK defterine dönüşüyor — taşıyıcı kolonlar (tasarım §D2)
-- =============================================================================
-- `fromStatus`/`toStatus`: stok kümesi tanımı SATIRA GÖMÜLMESİN diye. Satır "o gün
-- stoktaydı" demez, hangi statüden hangisine gittiğini söyler; kapsam kararı
-- değişirse geçmiş okuma yeniden hesaplanır ve as-of depo × statü kırılımı verir.
-- `reversesMovementId`: ters kayıt tespitinin TEK kaynağı; unique olması aynı ileri
-- satırın iki kez terslenmesini DB'de kapatır (SAP M7067 kuralının karşılığı).
--
-- GÜVENLİ: sekiz NULLABLE kolon (biri DEFAULT false) + üç FK + index. Mevcut 709
-- satıra dokunulmaz; hiçbiri okuma yolunu değiştirmez.
-- =============================================================================

ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "fromStatus"         "RollStatus";
ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "toStatus"           "RollStatus";
ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "reasonCode"         VARCHAR(64);
ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "transformGroupId"   UUID;
ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "rollVarianceId"     UUID;
ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "workOrderStepId"    UUID;
ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "reversesMovementId" UUID;
ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "preEpoch"           BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "warehouse_movements"
  ADD CONSTRAINT "warehouse_movements_rollVarianceId_fkey"
  FOREIGN KEY ("rollVarianceId") REFERENCES "roll_variances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouse_movements"
  ADD CONSTRAINT "warehouse_movements_workOrderStepId_fkey"
  FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouse_movements"
  ADD CONSTRAINT "warehouse_movements_reversesMovementId_fkey"
  FOREIGN KEY ("reversesMovementId") REFERENCES "warehouse_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "warehouse_movements_transformGroupId_idx" ON "warehouse_movements" ("transformGroupId");
CREATE INDEX IF NOT EXISTS "warehouse_movements_rollVarianceId_idx"   ON "warehouse_movements" ("rollVarianceId");
CREATE INDEX IF NOT EXISTS "warehouse_movements_workOrderStepId_idx"  ON "warehouse_movements" ("workOrderStepId");

-- Aynı ileri satır iki kez terslenemez. Düz unique yeterli: PostgreSQL NULL'ları
-- birbirinden AYRI sayar, yani bağsız satırlar yan yana durabilir.
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_movements_reversesMovementId_key"
  ON "warehouse_movements" ("reversesMovementId");
