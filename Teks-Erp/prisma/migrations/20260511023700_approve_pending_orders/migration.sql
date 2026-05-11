-- Phase 1'de ayrı bir "Onayla" adımı kullanılmıyor — siparişler artık
-- doğrudan APPROVED olarak oluşturuluyor (order.service.ts). Mevcut
-- PENDING kayıtlar bu nedenle iş emri/sevkiyat akışlarında "görünmez"
-- kalıyordu. Tek seferlik backfill ile hepsini APPROVED'a çekiyoruz.
UPDATE "orders" SET "status" = 'APPROVED' WHERE "status" = 'PENDING';
