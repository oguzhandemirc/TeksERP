-- Z1 ÜRETİM BELGE ZİNCİRİ (2026-09-18) — şema YALNIZ EKLER, her bağ NULLABLE doğar, göç GEREKMEZ.
-- Y1 = PİVOT `weaving_order_to_order_lines` (dokuma işi ↔ sipariş satırı, opsiyonel tahsis metresi)
-- Y2 = `warp_beams.weavingOrderId` (levent hangi iş için sarıldı)
-- Y3 KOLON YOK — top → dokuma işi `rolls.doffEventId → machine_runs.weavingOrderId` ile türetilir.
-- Varsayılan = bugünkü davranış: eski istemci alanları göndermez → bağsız kayıt (bayraklar kapalıyken serbest).
-- ⚠️ `migrate diff` çıktısındaki iki DropForeignKey satırı (rolls/swatches DEFERRABLE FK) BİLEREK atıldı.
-- İDEMPOTENT (deploy-kurulum.md): iki koşumda aynı sonuç — IF NOT EXISTS + pg_constraint korumalı FK'lar.

-- AlterTable
ALTER TABLE "warp_beams" ADD COLUMN IF NOT EXISTS "weavingOrderId" UUID;

-- CreateTable
CREATE TABLE IF NOT EXISTS "weaving_order_to_order_lines" (
    "id" UUID NOT NULL,
    "weavingOrderId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "allocatedM" DECIMAL(12,3),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "weaving_order_to_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "weaving_order_to_order_lines_orderLineId_idx" ON "weaving_order_to_order_lines"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "weaving_order_to_order_lines_weavingOrderId_orderLineId_key" ON "weaving_order_to_order_lines"("weavingOrderId", "orderLineId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "warp_beams_weavingOrderId_idx" ON "warp_beams"("weavingOrderId");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warp_beams_weavingOrderId_fkey') THEN
    ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_weavingOrderId_fkey" FOREIGN KEY ("weavingOrderId") REFERENCES "weaving_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weaving_order_to_order_lines_weavingOrderId_fkey') THEN
    ALTER TABLE "weaving_order_to_order_lines" ADD CONSTRAINT "weaving_order_to_order_lines_weavingOrderId_fkey" FOREIGN KEY ("weavingOrderId") REFERENCES "weaving_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weaving_order_to_order_lines_orderLineId_fkey') THEN
    ALTER TABLE "weaving_order_to_order_lines" ADD CONSTRAINT "weaving_order_to_order_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
