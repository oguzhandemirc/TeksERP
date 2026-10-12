-- Makine kaynaklı duruş D2: ham duruş kodu → sebep eşlemesi (kart tipi + ham kod, isteğe bağlı tezgah üst-yazımı).
-- ADDITIVE: boş doğan tablo + toplayıcıya nullable kart tipi kolonu; canlı veriye dokunmaz.
-- DEFERRABLE FK'lara dokunulmaz (üretilen DropForeignKey satırları silindi). İdempotent: yeniden koşum no-op.

ALTER TABLE "machine_collectors" ADD COLUMN IF NOT EXISTS "collectorType" VARCHAR(32);

CREATE TABLE IF NOT EXISTS "machine_stop_code_maps" (
    "id" UUID NOT NULL,
    "collectorType" VARCHAR(32) NOT NULL,
    "rawStopCode" VARCHAR(32) NOT NULL,
    "machineId" UUID,
    "stopReasonId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "machine_stop_code_maps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "machine_stop_code_maps_machineId_idx" ON "machine_stop_code_maps"("machineId");
CREATE INDEX IF NOT EXISTS "machine_stop_code_maps_stopReasonId_idx" ON "machine_stop_code_maps"("stopReasonId");

-- Canlı satırda anahtar başına tek eşleme; tezgahsız (kart tipi geneli) satır da tekil olsun diye NULLS NOT DISTINCT.
-- Pasif satır yer işgal etmez (yeniden tanımlanabilir). Tablo boş doğduğu için yumuşak kapı gerekmez.
CREATE UNIQUE INDEX IF NOT EXISTS "machine_stop_code_maps_live_uq"
  ON "machine_stop_code_maps"("collectorType", "rawStopCode", "machineId") NULLS NOT DISTINCT WHERE "isActive";

DO $$ BEGIN ALTER TABLE "machine_stop_code_maps" ADD CONSTRAINT "machine_stop_code_maps_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "machine_stop_code_maps" ADD CONSTRAINT "machine_stop_code_maps_stopReasonId_fkey" FOREIGN KEY ("stopReasonId") REFERENCES "reason_presets"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "machine_stop_code_maps" ADD CONSTRAINT "machine_stop_code_maps_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "machine_stop_code_maps" ADD CONSTRAINT "machine_stop_code_maps_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
