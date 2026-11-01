-- Brode fiyat birimi: metre | adet | vuruş (fabrika ayarı `finance.serviceBilling.brodeUnit`, varsayılan METER).
-- Yalnız NULL'lanabilir kolon + CHECK; geçmiş satırlara dokunulmaz (toplu UPDATE yok). NULL = bugünkü metre davranışı.

-- CreateEnum
CREATE TYPE "ServiceQtyUnit" AS ENUM ('METER', 'PIECE', 'STITCH');

-- Desen başına vuruş (dikiş) sayısı.
ALTER TABLE "fabric_property_values" ADD COLUMN "stitchCount" INTEGER;
ALTER TABLE "fabric_property_values" ADD CONSTRAINT "fabric_property_values_stitch_count_ck"
  CHECK ("stitchCount" IS NULL OR "stitchCount" > 0);

-- Tarife satırının birimi (NULL = METER).
ALTER TABLE "item_prices" ADD COLUMN "priceUnit" "ServiceQtyUnit";

-- Brode okumasında operatörün saydığı adet.
ALTER TABLE "roll_meter_readings" ADD COLUMN "pieceCount" INTEGER;
ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_piece_count_ck"
  CHECK ("pieceCount" IS NULL OR "pieceCount" > 0);

-- Bağın metre dışı faturalanan miktarı ve birimi — ikisi birlikte dolu ya da birlikte NULL.
ALTER TABLE "service_billing_links" ADD COLUMN "billedQty" DECIMAL(16,3),
ADD COLUMN "billedUnit" "ServiceQtyUnit";
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_billed_qty_ck"
  CHECK (("billedQty" IS NULL AND "billedUnit" IS NULL) OR ("billedQty" >= 0 AND "billedUnit" IN ('PIECE', 'STITCH')));
