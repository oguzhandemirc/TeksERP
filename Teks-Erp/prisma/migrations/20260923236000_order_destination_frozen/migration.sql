-- SİPARİŞ YÖNÜ DOĞUŞTA DONAR (2026-09-23, kullanıcı kararı)
--
-- ADDITIVE: nullable kolon + index. Varsayılan YOK — mevcut siparişler NULL kalır ("yön belirsiz");
-- geri doldurma ayrı bir script'tir (dry-run varsayılan, yalnız NULL satırlar, kullanıcı koşar) ve
-- yazdığı değer "o günkü kart yönü"dür, doğuştaki yön değil.
--
-- Raporlar bugüne dek siparişin yönünü CANLI kart zincirinden (şube → cari) okuyordu: cari kartı
-- değişince geçmiş siparişlerin yönü de değişiyordu. Sevkiyatın donmuş yönüyle aynı kalıp.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "destination" "ShipmentDestination";
CREATE INDEX IF NOT EXISTS "orders_destination_idx" ON "orders"("destination");
