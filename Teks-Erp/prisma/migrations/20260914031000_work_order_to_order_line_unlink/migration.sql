-- ③a TİCARİ PİVOT: iş emri ↔ sipariş kalemi bağı sil-yazdan damgaya (WOTOL-BAG-DAMGA-PLAN, 2026-09-14).
-- Bileşik PK damgayla yaşayamaz (aynı çift ikinci kez bağlanınca çakışır) → vekil `id` PK +
-- PARTIAL unique `(workOrderId, orderLineId) WHERE "unlinkedAt" IS NULL`.
-- Yeniden koşulabilir (IF [NOT] EXISTS / koşullu DO bloğu); BACKFILL: mevcut satırlar id alır, hepsi AÇIK.
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.

SET lock_timeout = '3s';

ALTER TABLE "work_order_to_order_lines" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "work_order_to_order_lines" ADD COLUMN IF NOT EXISTS "unlinkedAt"   TIMESTAMPTZ;
ALTER TABLE "work_order_to_order_lines" ADD COLUMN IF NOT EXISTS "unlinkedById" UUID;
ALTER TABLE "work_order_to_order_lines" ADD COLUMN IF NOT EXISTS "unlinkReason" VARCHAR(64);

-- Partial unique ÖNCE (açık çift tekilliği hiç boşta kalmasın), bileşik PK SONRA düşer, vekil PK gelir.
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_to_order_lines_active_pair_uq"
  ON "work_order_to_order_lines" ("workOrderId", "orderLineId") WHERE "unlinkedAt" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conname = 'work_order_to_order_lines_pkey' AND c.contype = 'p' AND a.attname = 'workOrderId'
  ) THEN
    ALTER TABLE "work_order_to_order_lines" DROP CONSTRAINT "work_order_to_order_lines_pkey";
    ALTER TABLE "work_order_to_order_lines" ADD CONSTRAINT "work_order_to_order_lines_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "work_order_to_order_lines_workOrderId_unlinkedAt_idx"
  ON "work_order_to_order_lines" ("workOrderId", "unlinkedAt");

-- Mevcut satırlar id aldı; Prisma `@default(uuid())` uygulama tarafındadır → DB varsayılanı düşer
-- (diğer UUID PK'larla aynı; `migrate diff` gürültüsü olmasın).
ALTER TABLE "work_order_to_order_lines" ALTER COLUMN "id" DROP DEFAULT;
