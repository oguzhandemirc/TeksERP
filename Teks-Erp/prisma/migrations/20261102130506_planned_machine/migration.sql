-- Gülkesim 2026-11-02: plan makinesi (yalnız öneri) — rota adımı şablonu + iş emri adımı.
-- NULL = bugünkü davranış; makine silinirse öneri düşer (SET NULL), defter değildir.

-- AlterTable
ALTER TABLE "route_steps" ADD COLUMN     "plannedMachineId" UUID;

-- AlterTable
ALTER TABLE "work_order_steps" ADD COLUMN     "plannedMachineId" UUID;

-- CreateIndex
CREATE INDEX "route_steps_plannedMachineId_idx" ON "route_steps"("plannedMachineId");

-- CreateIndex
CREATE INDEX "work_order_steps_plannedMachineId_idx" ON "work_order_steps"("plannedMachineId");

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_plannedMachineId_fkey" FOREIGN KEY ("plannedMachineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_plannedMachineId_fkey" FOREIGN KEY ("plannedMachineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
