-- Çift-commit'e DB seddi: (shipmentId, orderLineId) UNIQUE.
-- Güvenlik ağı: tarihî çift kayıt varsa (eski unmarkReady yarışı sınıfı) önce
-- tek satıra toplanır (qty = SUM) — sonra unique güvenle kurulur.
WITH dups AS (
  SELECT "shipmentId", "orderLineId", SUM(qty) AS total, MIN(id::text)::uuid AS keep_id
  FROM "shipment_allocations"
  GROUP BY "shipmentId", "orderLineId"
  HAVING COUNT(*) > 1
)
UPDATE "shipment_allocations" sa
SET qty = dups.total
FROM dups
WHERE sa.id = dups.keep_id;

DELETE FROM "shipment_allocations" sa
USING (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "shipmentId", "orderLineId" ORDER BY "createdAt", id::text
  ) AS rn
  FROM "shipment_allocations"
) t
WHERE sa.id = t.id AND t.rn > 1;

-- DropIndex (unique'in lider kolonu kapsıyor)
DROP INDEX "shipment_allocations_shipmentId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "shipment_allocations_shipmentId_orderLineId_key" ON "shipment_allocations"("shipmentId", "orderLineId");
