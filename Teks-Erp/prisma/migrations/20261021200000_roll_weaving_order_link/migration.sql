-- =============================================================================
-- S1 (2026-10-21) — Roll.weavingOrderId: KK1 "top KK1'de doğar" A-yolu (iş emri seçimi, çok tezgahlı iş)
-- ADDITIVE · idempotent · tamamı nullable — mevcut satır değişmez, varsayılan davranış bugünkü yol.
--  · kolon `rolls.weavingOrderId` (UUID, NULL) + FK weaving_orders (RESTRICT) + index
--  · CHECK `rolls_weaving_order_xor_ck`: doff bağı ∧ iş bağı AYNI ANDA olamaz (D11 çift yüklem yasağı) —
--    doff varsa iş doff→koşum zincirinden okunur, kolon yalnız doff'suz A-yolunda dolar.
-- `--create-only` çıktısındaki iki DEFERRABLE composite FK DropForeignKey satırı SİLİNDİ ([DB-21]).
-- =============================================================================

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "weavingOrderId" UUID;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rolls_weavingOrderId_idx" ON "rolls"("weavingOrderId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rolls_weavingOrderId_fkey') THEN
    ALTER TABLE "rolls" ADD CONSTRAINT "rolls_weavingOrderId_fkey"
      FOREIGN KEY ("weavingOrderId") REFERENCES "weaving_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- CHECK: doff bağı ile iş bağı aynı anda dolu olamaz (mevcut satırlarda weavingOrderId NULL → sağlanır).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rolls_weaving_order_xor_ck') THEN
    ALTER TABLE "rolls" ADD CONSTRAINT "rolls_weaving_order_xor_ck"
      CHECK (NOT ("doffEventId" IS NOT NULL AND "weavingOrderId" IS NOT NULL));
  END IF;
END $$;
