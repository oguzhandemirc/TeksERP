-- D4-H3 (D4-SEMA; ister 5.3/4.3, tasarım DALGA4 §9.4, K19): kasa masrafının makine / iş emri / hizmet kalemine payı.
-- ADDITIVE: yalnız yeni tablo + şema-dışı sedler; cash_transactions'a kolon eklenmez, toplu DELETE/UPDATE yok.
-- DEFTER: ters = DAMGA (revokedAt); değişim = damga + yeni satır.

CREATE TABLE IF NOT EXISTS "expense_allocations" (
    "id" UUID NOT NULL,
    "cashTransactionId" UUID NOT NULL,
    "machineId" UUID,
    "workOrderId" UUID,
    "serviceItemId" UUID,
    "sharePct" DECIMAL(5,2) NOT NULL,
    "clientToken" UUID NOT NULL,
    "createdById" UUID,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expense_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "expense_allocations_clientToken_key" ON "expense_allocations"("clientToken");
CREATE INDEX IF NOT EXISTS "expense_allocations_machineId_idx" ON "expense_allocations"("machineId");
CREATE INDEX IF NOT EXISTS "expense_allocations_workOrderId_idx" ON "expense_allocations"("workOrderId");
CREATE INDEX IF NOT EXISTS "expense_allocations_serviceItemId_idx" ON "expense_allocations"("serviceItemId");

DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_allocations_cashTransactionId_fkey') THEN
    ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_cashTransactionId_fkey" FOREIGN KEY ("cashTransactionId") REFERENCES "cash_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_allocations_machineId_fkey') THEN
    ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_allocations_workOrderId_fkey') THEN
    ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_allocations_serviceItemId_fkey') THEN
    ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $fk$;

-- Masrafın aktif bağları (Σ pay kontrolü + as-of okuma); damgalı satır tarihçedir. Prisma ifade edemez.
CREATE INDEX IF NOT EXISTS "expense_allocations_active_txn_idx" ON "expense_allocations"("cashTransactionId") WHERE "revokedAt" IS NULL;

-- Hedef TAM OLARAK BİRİ; pay 0 < x ≤ 100; damga açanı taşır.
DO $ck$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_allocations_target_ck') THEN
    ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_target_ck"
      CHECK (num_nonnulls("machineId", "workOrderId", "serviceItemId") = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_allocations_share_ck') THEN
    ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_share_ck" CHECK ("sharePct" > 0 AND "sharePct" <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_allocations_revoke_actor_chk') THEN
    ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_revoke_actor_chk" CHECK ("revokedAt" IS NULL OR "revokedById" IS NOT NULL);
  END IF;
END $ck$;
