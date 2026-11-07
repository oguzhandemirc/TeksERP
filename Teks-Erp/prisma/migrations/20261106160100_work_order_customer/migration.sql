-- ADDITIVE: iş emrinin kendi müşterisi (yalnız CUSTOMER_GOODS_SERVICE yazar).
-- Nullable kolon + FK (RESTRICT) + index; mevcut satırlar DEĞİŞMEZ (hepsi NULL, hiçbiri yeni türde değil → CHECK geçer).
-- CHECK: Fason (müşteri malı) türünde müşteri ZORUNLU. Enum literal'i önceki migration'da commit edildi (55P04 yok).
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "customerId" UUID;

CREATE INDEX IF NOT EXISTS "work_orders_customerId_idx" ON "work_orders"("customerId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_customerId_fkey') THEN
    ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_customer_goods_customer_check') THEN
    ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_goods_customer_check"
      CHECK ("type" <> 'CUSTOMER_GOODS_SERVICE' OR "customerId" IS NOT NULL);
  END IF;
END $$;
