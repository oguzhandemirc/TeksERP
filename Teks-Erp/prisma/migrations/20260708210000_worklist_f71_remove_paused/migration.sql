-- Worklist Faz 13 — F71: WorkOrderStatus'tan ölü PAUSED değerini çıkar.
-- App'te hiç atanmıyordu (0 satır — doğrulandı); backend 16 referansı temizledi (bba0f15,
-- davranış-koruyan). Postgres'te enum-değer silme = tip recreate. work_orders.status TEK
-- kullanıcı kolon (doğrulandı); default 'PLANNED' (silme sırasında drop/re-add).
-- Sıra: app-code (backend, hazır) -> bu migration -> merge sonrası prisma generate (PAUSED
-- referansı kalmadığından tsc yeşil kalır).
SET statement_timeout = 0;

ALTER TABLE "work_orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "WorkOrderStatus" RENAME TO "WorkOrderStatus_old";
CREATE TYPE "WorkOrderStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
ALTER TABLE "work_orders" ALTER COLUMN "status" TYPE "WorkOrderStatus" USING "status"::text::"WorkOrderStatus";
ALTER TABLE "work_orders" ALTER COLUMN "status" SET DEFAULT 'PLANNED';
DROP TYPE "WorkOrderStatus_old";
