-- V-5 TUR2 §2 — Kod içindeki GGAAYY ile createdAt'in FABRİKA günü uyuşuyor mu?
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
p AS (
  SELECT kaynak, kod, "createdAt",
    substring(kod from '^[A-Z]+(\d{6})') AS gg,
    to_char(("createdAt" AT TIME ZONE 'Europe/Istanbul'), 'DDMMYY') AS fabrika_gun,
    to_char(("createdAt" AT TIME ZONE 'UTC'), 'DDMMYY') AS utc_gun,
    EXTRACT(hour FROM ("createdAt" AT TIME ZONE 'Europe/Istanbul')) AS saat_ist
  FROM src WHERE kod IS NOT NULL
)
SELECT kaynak,
  count(*) AS toplam,
  count(*) FILTER (WHERE gg <> fabrika_gun) AS kod_gunu_FABRIKADAN_FARKLI,
  count(*) FILTER (WHERE gg = utc_gun AND gg <> fabrika_gun) AS UTC_gunune_uyan,
  count(*) FILTER (WHERE saat_ist < 3) AS gece_00_03_ist,
  count(*) FILTER (WHERE saat_ist < 3 AND gg <> fabrika_gun) AS gece_ve_kaymis
FROM p WHERE gg IS NOT NULL
GROUP BY 1 ORDER BY 3 DESC;
