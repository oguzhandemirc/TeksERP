-- =============================================================================
-- `shipment_events` FK'sı RESTRICT → CASCADE
-- =============================================================================
-- İlk yazımda RESTRICT kondu ("defter satırı kaybolmasın") ama ölçüldü: 66 bekçi
-- temizliğinde sevkiyat siliyor ve hepsi 23503 ile kilitleniyordu.
--
-- Doktrin RESTRICT İSTEMİYOR: yasak olan, defter satırını "olay olmamış
-- göstermek için" silmektir — üst kayıt HARD DELETE edilirken çocuğu düşürmek
-- değil. `Shipment` canlıda zaten hiç hard delete edilmez (iptal bir DURUM
-- GEÇİŞİDİR), yani bu dal ÜRETİMDE KOŞMAZ. Ev emsali: `WarehouseMovement.roll`
-- de `Cascade`.
--
-- GÜVENLİ: yalnız FK davranışı değişir; satır silinmez, kolon değişmez.
-- =============================================================================

ALTER TABLE "shipment_events" DROP CONSTRAINT IF EXISTS "shipment_events_shipmentId_fkey";
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
