-- SARF STOK DEFTERİ (kuşak / kurşun şeridi) — ADDITIVE: yeni enum + yeni tablo + nullable kolon.
-- Geçmiş satırlara dokunulmaz (toplu UPDATE/DELETE yok); idempotent (IF NOT EXISTS).

DO $consumable_kind$ BEGIN
  CREATE TYPE "ConsumableMovementKind" AS ENUM ('RECEIPT_IN', 'RECEIPT_CANCEL_OUT', 'CONSUMPTION_OUT', 'CONSUMPTION_REVERSAL_IN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $consumable_kind$;

CREATE TABLE IF NOT EXISTS "consumable_movements" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "kind" "ConsumableMovementKind" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "goodsReceiptId" UUID,
    "rollOperationId" UUID,
    "reversesId" UUID,
    "reason" VARCHAR(300),
    "userId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consumable_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consumable_movements_qty_positive_ck" CHECK ("qty" > 0),
    CONSTRAINT "consumable_movements_reversal_link_ck" CHECK (("kind" IN ('RECEIPT_CANCEL_OUT', 'CONSUMPTION_REVERSAL_IN')) = ("reversesId" IS NOT NULL)),
    CONSTRAINT "consumable_movements_consumption_link_ck" CHECK (("kind" = 'CONSUMPTION_OUT') = ("rollOperationId" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "consumable_movements_reversesId_key" ON "consumable_movements"("reversesId");
CREATE UNIQUE INDEX IF NOT EXISTS "consumable_movements_rollOperationId_itemId_key" ON "consumable_movements"("rollOperationId", "itemId");
CREATE INDEX IF NOT EXISTS "consumable_movements_itemId_createdAt_idx" ON "consumable_movements"("itemId", "createdAt");
CREATE INDEX IF NOT EXISTS "consumable_movements_goodsReceiptId_idx" ON "consumable_movements"("goodsReceiptId");

DO $consumable_fks$ BEGIN
  ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_rollOperationId_fkey" FOREIGN KEY ("rollOperationId") REFERENCES "roll_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "consumable_movements" ADD CONSTRAINT "consumable_movements_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "consumable_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $consumable_fks$;

-- Kuşak değeri → sarf kalemi (top başına 1 birim). Boş = düşüm yok (bugünkü davranış).
ALTER TABLE "fabric_property_values" ADD COLUMN IF NOT EXISTS "consumableItemId" UUID;
CREATE INDEX IF NOT EXISTS "fabric_property_values_consumableItemId_idx" ON "fabric_property_values"("consumableItemId");
DO $fpv_consumable_fk$ BEGIN
  ALTER TABLE "fabric_property_values" ADD CONSTRAINT "fabric_property_values_consumableItemId_fkey" FOREIGN KEY ("consumableItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fpv_consumable_fk$;
