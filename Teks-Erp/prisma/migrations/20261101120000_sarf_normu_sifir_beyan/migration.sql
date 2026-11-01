-- Hizmet sarf normu: qtyPerM = 0 "bu hizmet sarf kullanmaz" AÇIK beyanıdır (kârlılık ölçülmüş 0 sayar);
-- norm satırı hiç yoksa yine "eksik: sarf normu". Negatif hâlâ red. Veri değişmez (yalnız CHECK gevşer).
ALTER TABLE "service_consumable_norms" DROP CONSTRAINT IF EXISTS "service_consumable_norms_qty_ck";
ALTER TABLE "service_consumable_norms" ADD CONSTRAINT "service_consumable_norms_qty_ck" CHECK ("qtyPerM" >= 0 AND "serviceItemId" <> "consumableItemId");
