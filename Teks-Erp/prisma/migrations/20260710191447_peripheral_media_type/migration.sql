-- CreateEnum
CREATE TYPE "PrinterMediaType" AS ENUM ('DIRECT_THERMAL', 'THERMAL_TRANSFER');

-- AlterTable: baskı yöntemi (ribonlu=TT / ribonsuz=DT); boş → yazıcı otomatik.
ALTER TABLE "peripheral_devices" ADD COLUMN "mediaType" "PrinterMediaType";
