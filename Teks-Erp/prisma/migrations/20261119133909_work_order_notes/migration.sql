-- İş emri PLANLAMA notu (2026-11-19) — yeni tablo, ADDITIVE.
-- Mevcut tablolara dokunmaz, backfill yok. `migrate dev --create-only` çıktısındaki iki
-- DEFERRABLE composite FK'nın DropForeignKey satırları SİLİNDİ. İdempotent: elle koşulabilir.

-- CreateTable
CREATE TABLE IF NOT EXISTS "work_order_notes" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "work_order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_notes_workOrderId_key" ON "work_order_notes"("workOrderId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
