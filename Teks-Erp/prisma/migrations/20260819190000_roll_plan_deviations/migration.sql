-- PLAN-GERÇEK SAPMA DEFTERİ (2026-08-19)
-- Tambur plan kapısında "yine de bitir" ile onaylanan sapmaların KALICI kaydı.
-- Neden ayrı tablo (SystemLog / RollOperation.metadata / enum yolları elendi):
-- bkz. schema.prisma `RollPlanDeviation` başlığı ve docs/history/CLAUDE-NOT-ARSIVI.md.
--
-- Salt ADDITIVE (tek CREATE TABLE + index + FK) — mevcut tabloya dokunmaz,
-- yazma kilidi almaz, vardiya içinde uygulanabilir.
--
-- ⚠️ `migrate diff` çıktısındaki iki `DropForeignKey` satırı (rolls/swatches
-- `sackId_shipmentId_consistency`) BİLEREK SİLİNDİ: datamodel'de temsil
-- edilemeyen DEFERRABLE composite FK'lar her diff'te düşürülmek istenir
-- (schema.prisma:2557-2558 + Teks-Erp/CLAUDE.md perf kuralı 4).

-- CreateTable
CREATE TABLE "roll_plan_deviations" (
    "id" UUID NOT NULL,
    "confirmationId" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "childRollId" UUID,
    "workOrderId" UUID NOT NULL,
    "workOrderStepId" UUID,
    "field" VARCHAR(16) NOT NULL,
    "rollValue" VARCHAR(120),
    "planValue" VARCHAR(120),
    "qtyM" DECIMAL(12,3) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "confirmedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_plan_deviations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roll_plan_deviations_rollId_idx" ON "roll_plan_deviations"("rollId");

-- CreateIndex
CREATE INDEX "roll_plan_deviations_childRollId_idx" ON "roll_plan_deviations"("childRollId");

-- CreateIndex
CREATE INDEX "roll_plan_deviations_workOrderId_idx" ON "roll_plan_deviations"("workOrderId");

-- CreateIndex
CREATE INDEX "roll_plan_deviations_workOrderStepId_idx" ON "roll_plan_deviations"("workOrderStepId");

-- CreateIndex
CREATE INDEX "roll_plan_deviations_field_createdAt_idx" ON "roll_plan_deviations"("field", "createdAt");

-- CreateIndex
CREATE INDEX "roll_plan_deviations_confirmedById_createdAt_idx" ON "roll_plan_deviations"("confirmedById", "createdAt");

-- CreateIndex
CREATE INDEX "roll_plan_deviations_createdAt_idx" ON "roll_plan_deviations"("createdAt");

-- CreateIndex
CREATE INDEX "roll_plan_deviations_confirmationId_idx" ON "roll_plan_deviations"("confirmationId");

-- AddForeignKey
ALTER TABLE "roll_plan_deviations" ADD CONSTRAINT "roll_plan_deviations_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_plan_deviations" ADD CONSTRAINT "roll_plan_deviations_childRollId_fkey" FOREIGN KEY ("childRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_plan_deviations" ADD CONSTRAINT "roll_plan_deviations_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_plan_deviations" ADD CONSTRAINT "roll_plan_deviations_workOrderStepId_fkey" FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_plan_deviations" ADD CONSTRAINT "roll_plan_deviations_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
