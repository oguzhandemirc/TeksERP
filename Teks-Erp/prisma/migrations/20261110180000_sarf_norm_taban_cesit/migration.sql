-- =============================================================================
-- SARF NORMU TABANI + ÇEŞİDİ · TOP BAŞINA TÜKETİM (2026-11-10, GK sarf tüketimi K1–K3)
-- =============================================================================
-- ADDITIVE: yeni enum + iki nullable/varsayılanlı kolon + bir nullable kolon; mevcut satırlar
-- PER_METER / çeşitsiz kalır → kurşun düşümü ve kârlılık bayt-aynı.
--  · service_consumable_norms.basis (PER_METER | PER_ROLL) · propertyValueId (FK Restrict, gramaj çeşidi)
--  · aktif tekillik (hizmet, sarf) → (hizmet, sarf, çeşit) NULLS NOT DISTINCT (çeşitsiz norm yine tektir)
--  · consumable_movements.birthRollId — tambur çıktı topu başına tüketim; tüketim satırı iz XOR doğan top
-- Prisma migration tek tx'te koşar; tablolar küçük (norm kataloğu, sarf defteri) — yine de reçete gereği:
SET statement_timeout = 0;

DO $$ BEGIN
  CREATE TYPE "ConsumableNormBasis" AS ENUM ('PER_METER', 'PER_ROLL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "service_consumable_norms" ADD COLUMN IF NOT EXISTS "basis" "ConsumableNormBasis" NOT NULL DEFAULT 'PER_METER';
ALTER TABLE "service_consumable_norms" ADD COLUMN IF NOT EXISTS "propertyValueId" UUID;
CREATE INDEX IF NOT EXISTS "service_consumable_norms_propertyValueId_idx" ON "service_consumable_norms"("propertyValueId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_consumable_norms_propertyValueId_fkey') THEN
    ALTER TABLE "service_consumable_norms" ADD CONSTRAINT "service_consumable_norms_propertyValueId_fkey" FOREIGN KEY ("propertyValueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Aktif tekillik çeşidi de kapsar: "Kurşun + 50 gr → İP 50" ile "Kurşun + 25 gr → İP 25" aynı anda aktif olabilir.
DROP INDEX IF EXISTS "service_consumable_norms_active_pair_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "service_consumable_norms_active_pair_uq"
  ON "service_consumable_norms"("serviceItemId", "consumableItemId", "propertyValueId") NULLS NOT DISTINCT
  WHERE "revokedAt" IS NULL;

ALTER TABLE "consumable_movements" ADD COLUMN IF NOT EXISTS "birthRollId" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "consumable_movements_birthRollId_itemId_key" ON "consumable_movements"("birthRollId", "itemId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consumable_movements_birthRollId_fkey') THEN
    ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_birthRollId_fkey" FOREIGN KEY ("birthRollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Tüketim satırı TAM OLARAK BİR kaynağa bağlı: üretim izi (kurşun/kuşak) ya da doğan tambur topu (PER_ROLL).
ALTER TABLE "consumable_movements" DROP CONSTRAINT IF EXISTS "consumable_movements_consumption_link_ck";
ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_consumption_link_ck"
  CHECK (("kind" = 'CONSUMPTION_OUT') = (num_nonnulls("rollOperationId", "birthRollId") = 1)
         AND ("kind" = 'CONSUMPTION_OUT' OR "birthRollId" IS NULL));
