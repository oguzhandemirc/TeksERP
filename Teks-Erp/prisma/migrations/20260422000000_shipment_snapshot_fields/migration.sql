-- Shipment belgesi snapshot alanları
ALTER TABLE "shipments"
  ADD COLUMN "customerCodeSnapshot" TEXT,
  ADD COLUMN "customerNameSnapshot" TEXT;

ALTER TABLE "shipment_items"
  ADD COLUMN "rollBarcodeSnapshot" TEXT,
  ADD COLUMN "itemCodeSnapshot" TEXT,
  ADD COLUMN "itemNameSnapshot" TEXT,
  ADD COLUMN "orderNumberSnapshot" TEXT;
