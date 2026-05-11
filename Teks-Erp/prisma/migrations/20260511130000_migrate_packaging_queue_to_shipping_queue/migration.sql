-- =============================================================================
-- Açık PackagingQueue satırlarını sipariş-bazlı ShippingQueue'a taşı
-- =============================================================================
-- Yeni akış: planlamacı siparişi kuyruğa alır (rulo değil). Eskiden farklı
-- rulolar aynı sipariş için ayrı kuyruk satırı oluşturuyordu — yeni modelde
-- tek satır. Aynı plannedOrderId için tek bir ShippingQueue satırı üretiyoruz.
-- DONE / CANCELLED kayıtlar tarihçe için yerinde kalır.
-- =============================================================================

INSERT INTO "shipping_queue" (
  "id",
  "orderId",
  "priority",
  "isUrgent",
  "urgentMarkedAt",
  "status",
  "addedByUserId",
  "note",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  pq."plannedOrderId",
  MIN(pq."priority"),
  bool_or(pq."isUrgent"),
  MIN(pq."urgentMarkedAt"),
  'WAITING'::"ShippingQueueStatus",
  MAX(pq."addedByUserId"),
  STRING_AGG(DISTINCT pq."note", ' | '),
  MIN(pq."createdAt"),
  NOW()
FROM "packaging_queue" pq
WHERE pq."status" IN ('WAITING', 'TAKEN')
  AND pq."plannedOrderId" IS NOT NULL
  -- Aynı sipariş zaten ShippingQueue'da varsa atla (idempotent migration)
  AND NOT EXISTS (
    SELECT 1 FROM "shipping_queue" sq WHERE sq."orderId" = pq."plannedOrderId"
  )
GROUP BY pq."plannedOrderId";

-- Eski açık kayıtları CANCELLED yap; rulolar etkilenmez (rollId Roll.sackId
-- üzerinden bağımsız). DONE/CANCELLED zaten son durumda.
UPDATE "packaging_queue"
SET
  "status" = 'CANCELLED',
  "cancelledAt" = NOW(),
  "cancelReason" = 'Sipariş-bazlı kuyruğa taşındı'
WHERE "status" IN ('WAITING', 'TAKEN');
