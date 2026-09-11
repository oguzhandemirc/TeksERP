-- =============================================================================
-- WarehouseMovement.stockCountId — sayım fark fişinin kaynak belge bağı
-- =============================================================================
-- Sayımın yazdığı `CANCEL` satırı sayıma yalnız `notes` metniyle bağlıydı; storno
-- (`CANCEL_REVERSAL`) karşı satırını belgeye FK ile bağlar (defter reçetesi ⑤:
-- kaynak belge FK'ları). Eski satırlar DOLDURULMAZ — geçmiş uydurulmaz.
--
-- GÜVENLİ: NULLABLE kolon + FK + index; mevcut satırlara dokunulmaz.
-- =============================================================================

ALTER TABLE "warehouse_movements" ADD COLUMN IF NOT EXISTS "stockCountId" UUID;

CREATE INDEX IF NOT EXISTS "warehouse_movements_stockCountId_idx"
  ON "warehouse_movements" ("stockCountId");

DO $$ BEGIN
  ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_stockCountId_fkey"
    FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
