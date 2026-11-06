-- Hizmet fiyat tablosu D4 (2026-11-06): `POST /api/service-prices` kayıt yaratan uçtur → `clientToken @unique`
-- (idempotency sözleşmesi). NULLABLE: eski `POST /api/item-prices` ve içe aktarma token'sız yazar (bugünkü davranış).
-- GÜVENLİ: tek nullable kolon, UPDATE yok; unique index boş kolonda anlık.
ALTER TABLE "item_prices" ADD COLUMN IF NOT EXISTS "clientToken" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "item_prices_clientToken_key" ON "item_prices"("clientToken");
