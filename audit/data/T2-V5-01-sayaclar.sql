-- V-5 TUR2 §1 — Günlük sayaç envanteri: mükerrer + boşluk + tavan yakınlığı
WITH src AS (
  SELECT 'orders.orderNumber' AS kaynak, "orderNumber" AS kod, "createdAt" FROM orders
  UNION ALL SELECT 'work_orders.workOrderNumber', "workOrderNumber", "createdAt" FROM work_orders
  UNION ALL SELECT 'sacks.sackNo', "sackNo", "createdAt" FROM sacks
  UNION ALL SELECT 'shipments.shipmentNo', "shipmentNo", "createdAt" FROM shipments
  UNION ALL SELECT 'direct_shipments.shipmentNo', "shipmentNo", "createdAt" FROM direct_shipments
  UNION ALL SELECT 'subcontractor_dispatches.dispatchNo', "dispatchNo", "createdAt" FROM subcontractor_dispatches
  UNION ALL SELECT 'subcontractor_receipts.receiptNo', "receiptNo", "createdAt" FROM subcontractor_receipts
  UNION ALL SELECT 'kartela_dispatches.dispatchNo', "dispatchNo", "createdAt" FROM kartela_dispatches
  UNION ALL SELECT 'kartela_receipts.receiptNo', "receiptNo", "createdAt" FROM kartela_receipts
  UNION ALL SELECT 'swatches.cardNumber', "cardNumber", "createdAt" FROM swatches
  UNION ALL SELECT 'traveler_cards.cardNumber', "cardNumber", "createdAt" FROM traveler_cards
  UNION ALL SELECT 'free_documents.documentNo', "documentNo", "createdAt" FROM free_documents
  UNION ALL SELECT 'manifests.manifestNo', "manifestNo", "createdAt" FROM manifests
  UNION ALL SELECT 'customers.code', "code", "createdAt" FROM customers
  UNION ALL SELECT 'items.code', "code", "createdAt" FROM items
  UNION ALL SELECT 'fabric_properties.code', "code", "createdAt" FROM fabric_properties
  UNION ALL SELECT 'batches.batchNumber', "batchNumber", "createdAt" FROM batches
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
  FROM parsed
  WHERE gun IS NOT NULL AND kuyruk ~ '^\d+$'
)
SELECT kaynak, seri,
  count(*) AS toplam,
  count(DISTINCT kod) AS distinct_kod,
  count(*) - count(DISTINCT kod) AS MUKERRER,
  count(DISTINCT (seri,gun)) AS gun_sayisi,
  max(seq) AS en_yuksek_sira,
  sum(CASE WHEN seq > 9000 THEN 1 ELSE 0 END) AS sira_9000_ustu
FROM ok
GROUP BY 1,2
ORDER BY 1,2;
