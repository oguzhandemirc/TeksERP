-- Shipment.printSnapshot: Finalize anında yazdırma verisinin tam donmuş kopyası.
-- PREPARING iken NULL, SHIPPED'e geçerken doldurulur.

ALTER TABLE "shipments" ADD COLUMN "printSnapshot" JSONB;
