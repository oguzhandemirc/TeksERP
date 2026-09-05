-- V-5 TUR2 §1 — Günlük sayaç BOŞLUKLARI (LEAD ile)
WITH src AS (
  SELECT 'orders.orderNumber' AS kaynak, "orderNumber" AS kod, "createdAt" FROM orders
  UNION ALL SELECT 'work_orders.workOrderNumber', "workOrderNumber", "createdAt" FROM work_orders
  UNION ALL SELECT 'sacks.sackNo', "sackNo", "createdAt" FROM sacks
  UNION ALL SELECT 'shipments.shipmentNo', "shipmentNo", "createdAt" FROM shipments
  UNION ALL SELECT 'subcontractor_dispatches.dispatchNo', "dispatchNo", "createdAt" FROM subcontractor_dispatches
  UNION ALL SELECT 'subcontractor_receipts.receiptNo', "receiptNo", "createdAt" FROM subcontractor_receipts
  UNION ALL SELECT 'traveler_cards.cardNumber', "cardNumber", "createdAt" FROM traveler_cards
  UNION ALL SELECT 'customers.code', "code", "createdAt" FROM customers
  UNION ALL SELECT 'rolls.barcode', "barcode", "createdAt" FROM rolls
),
parsed AS (
  SELECT kaynak, kod, "createdAt",
    substring(kod from '^[A-Z]+') AS onek,
    substring(kod from '^[A-Z]+(\d{6})') AS gun,
    substring(kod from '^[A-Z]+\d{6}([HF]?)') AS tip,
    NULLIF(regexp_replace(kod, '^[A-Z]+\d{6}[HF]?', ''), '') AS kuyruk
  FROM src WHERE kod IS NOT NULL
),
ok AS (
  SELECT kaynak, onek||COALESCE(tip,'') AS seri, gun, kod, "createdAt", kuyruk::bigint AS seq
  FROM parsed WHERE gun IS NOT NULL AND kuyruk ~ '^\d+$'
),
g AS (
  SELECT kaynak, seri, gun, seq,
    LEAD(seq) OVER (PARTITION BY kaynak, seri, gun ORDER BY seq) AS sonraki
  FROM ok
)
SELECT kaynak, seri,
  count(*) FILTER (WHERE sonraki IS NOT NULL AND sonraki - seq > 1) AS bosluk_araligi,
  COALESCE(sum(sonraki - seq - 1) FILTER (WHERE sonraki - seq > 1),0) AS kayip_numara,
  count(DISTINCT gun) FILTER (WHERE sonraki - seq > 1) AS bosluklu_gun,
  max(sonraki - seq - 1) AS en_buyuk_bosluk
FROM g
GROUP BY 1,2
HAVING count(*) FILTER (WHERE sonraki IS NOT NULL AND sonraki - seq > 1) > 0
ORDER BY 4 DESC;
