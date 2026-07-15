-- Doğrudan sevk karşılanması OLAY-başına (DirectShipment). Bir dispatch'ten birden çok
-- KISMI doğrudan sevk çıkabilir ve AYNI sipariş satırına HER olayda tekrar karşılanma
-- yazılabilir. Unique constraint (dispatchId, orderLineId) → (directShipmentId, orderLineId).
-- (Bug: "kalan kısma tekrar sevk" P2002 unique-constraint hatası veriyordu.)
--
-- El yapımı: bu şema custom composite-FK drift'i taşır (rolls/swatches
-- _sackId_shipmentId_consistency_fkey) — migrate diff onları spurious DROP eder;
-- bu migration YALNIZ ilgili index'i değiştirir.

-- DropIndex
DROP INDEX "subcontractor_direct_ship_allocations_dispatchId_orderLineId_ke";

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_direct_ship_allocations_dsId_orderLineId_key" ON "subcontractor_direct_ship_allocations"("directShipmentId", "orderLineId");
