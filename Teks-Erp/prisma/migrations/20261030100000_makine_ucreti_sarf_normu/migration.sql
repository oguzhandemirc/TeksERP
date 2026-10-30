-- D4-G1a (ister 4.9/5.10 kârlılık zemini): makine saat ücreti + hizmet sarf normu ana verisi.
-- ADDITIVE: yalnız iki yeni tablo + şema-dışı sedler; toplu DELETE/UPDATE yok, mevcut tabloya dokunulmaz.
-- İkisi de ③a damgalı sürüm: satır silinmez, değişim = eski satırın damgası + yeni satır.

CREATE TABLE IF NOT EXISTS "machine_cost_rates" (
    "id" UUID NOT NULL,
    "machineId" UUID NOT NULL,
    "hourRateTry" DECIMAL(12,4) NOT NULL,
    "normMPerHour" DECIMAL(10,2),
    "note" VARCHAR(300),
    "clientToken" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "machine_cost_rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_consumable_norms" (
    "id" UUID NOT NULL,
    "serviceItemId" UUID NOT NULL,
    "consumableItemId" UUID NOT NULL,
    "qtyPerM" DECIMAL(12,6) NOT NULL,
    "unit" VARCHAR(16) NOT NULL,
    "note" VARCHAR(300),
    "clientToken" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "service_consumable_norms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "machine_cost_rates_clientToken_key" ON "machine_cost_rates"("clientToken");
CREATE INDEX IF NOT EXISTS "machine_cost_rates_machineId_createdAt_idx" ON "machine_cost_rates"("machineId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "service_consumable_norms_clientToken_key" ON "service_consumable_norms"("clientToken");
CREATE INDEX IF NOT EXISTS "service_consumable_norms_serviceItemId_createdAt_idx" ON "service_consumable_norms"("serviceItemId", "createdAt");
CREATE INDEX IF NOT EXISTS "service_consumable_norms_consumableItemId_idx" ON "service_consumable_norms"("consumableItemId");

DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'machine_cost_rates_machineId_fkey') THEN
    ALTER TABLE "machine_cost_rates" ADD CONSTRAINT "machine_cost_rates_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_consumable_norms_serviceItemId_fkey') THEN
    ALTER TABLE "service_consumable_norms" ADD CONSTRAINT "service_consumable_norms_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_consumable_norms_consumableItemId_fkey') THEN
    ALTER TABLE "service_consumable_norms" ADD CONSTRAINT "service_consumable_norms_consumableItemId_fkey" FOREIGN KEY ("consumableItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $fk$;

-- Makine başına / (hizmet, sarf) çifti başına en çok bir AKTİF sürüm; damgalı satır tarihçedir. Prisma ifade edemez.
CREATE UNIQUE INDEX IF NOT EXISTS "machine_cost_rates_active_machine_uq" ON "machine_cost_rates"("machineId") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "service_consumable_norms_active_pair_uq" ON "service_consumable_norms"("serviceItemId", "consumableItemId") WHERE "revokedAt" IS NULL;

-- Sayı sedleri + damga açanı taşır (kim kaldırdı görünür kalsın).
DO $ck$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'machine_cost_rates_rate_ck') THEN
    ALTER TABLE "machine_cost_rates" ADD CONSTRAINT "machine_cost_rates_rate_ck" CHECK ("hourRateTry" >= 0 AND ("normMPerHour" IS NULL OR "normMPerHour" > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'machine_cost_rates_revoke_actor_chk') THEN
    ALTER TABLE "machine_cost_rates" ADD CONSTRAINT "machine_cost_rates_revoke_actor_chk" CHECK ("revokedAt" IS NULL OR "revokedById" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_consumable_norms_qty_ck') THEN
    ALTER TABLE "service_consumable_norms" ADD CONSTRAINT "service_consumable_norms_qty_ck" CHECK ("qtyPerM" > 0 AND "serviceItemId" <> "consumableItemId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_consumable_norms_revoke_actor_chk') THEN
    ALTER TABLE "service_consumable_norms" ADD CONSTRAINT "service_consumable_norms_revoke_actor_chk" CHECK ("revokedAt" IS NULL OR "revokedById" IS NOT NULL);
  END IF;
END $ck$;
