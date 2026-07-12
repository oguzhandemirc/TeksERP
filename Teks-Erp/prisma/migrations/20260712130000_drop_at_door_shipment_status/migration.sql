-- AT_DOOR (kapı önü) durumu KALDIRILDI. Yeni sevk akışı:
--   • Sevk onayı KAPALI (varsayılan): createShipment çuvalları doğrudan DISPATCHED kurar.
--   • Sevk onayı AÇIK: createShipment PLANNED kurar; Sevk Kapısı'ndan ayrıca dispatch edilir.
-- Ara "kapı önü" durağı yok. Mevcut AT_DOOR sevkiyatları PLANNED'e taşınır (dispatch edilebilir).

UPDATE "shipments" SET "status" = 'PLANNED' WHERE "status" = 'AT_DOOR';

-- Enum'dan AT_DOOR'u çıkar (rename-type deseni: yeni tip + USING cast + eskiyi drop).
ALTER TYPE "ShipmentStatus" RENAME TO "ShipmentStatus_old";
CREATE TYPE "ShipmentStatus" AS ENUM ('PLANNED', 'DISPATCHED', 'CANCELLED');
ALTER TABLE "shipments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "shipments" ALTER COLUMN "status" TYPE "ShipmentStatus" USING ("status"::text::"ShipmentStatus");
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'PLANNED';
DROP TYPE "ShipmentStatus_old";
