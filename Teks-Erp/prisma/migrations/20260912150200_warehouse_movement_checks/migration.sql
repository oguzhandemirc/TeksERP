-- =============================================================================
-- Defterin DB seddi — anlamsız satır YAZILAMAZ (tasarım §D7)
-- =============================================================================
-- Bugün helper `qty < 0` ya da iki depo alanı da boş olan satırı SESSİZCE atlıyor;
-- atlanan satır = yazılmamış hareket = sessizce kayan toplam. Sed DB'ye taşınıyor.
--
-- Ölçüldü (fabrika kopyası, 721 satır): qty <= 0 → 0 · qty NULL → 0 · iki yön de
-- boş → 0. Yani mevcut veri kısıtı ihlal ETMİYOR; yine de `NOT VALID` ile eklenip
-- doğrulama AYRI migration'a bırakılıyor (uzun ACCESS EXCLUSIVE kilidi doğmasın).
-- =============================================================================

ALTER TABLE "warehouse_movements"
  ADD CONSTRAINT "warehouse_movements_qty_positive" CHECK ("qty" > 0) NOT VALID;

ALTER TABLE "warehouse_movements"
  ADD CONSTRAINT "warehouse_movements_direction_present"
  CHECK ("fromWarehouseId" IS NOT NULL OR "toWarehouseId" IS NOT NULL) NOT VALID;
