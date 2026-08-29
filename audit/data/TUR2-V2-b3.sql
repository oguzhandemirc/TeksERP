\echo '=== V2-Q29 gunluk sayac BOSLUK/MUKERRER (LEAD) — SIP/SVK/CV ==='
WITH k AS (
  SELECT 'SIP' AS p, "orderNumber" AS v FROM orders WHERE "orderNumber" ~ '^SIP[0-9]{10}$'
  UNION ALL SELECT 'SVK', "shipmentNo" FROM shipments WHERE "shipmentNo" ~ '^SVK[0-9]{10}$'
  UNION ALL SELECT 'CV', "sackNo" FROM sacks WHERE "sackNo" ~ '^CV[0-9]{10}$'),
s AS (SELECT p, substr(v,length(p)+1,6) AS gun, substr(v,length(p)+7)::int AS sira FROM k),
d AS (SELECT p,gun,sira, lead(sira) OVER (PARTITION BY p,gun ORDER BY sira) AS nx FROM s)
SELECT p,gun,sira,nx,(nx-sira) AS atlama FROM d WHERE nx IS NOT NULL AND nx-sira<>1 ORDER BY 1,2,3;
\echo '=== V2-Q30 gun basi ilk sira 1 mi ==='
WITH k AS (
  SELECT 'SIP' AS p, "orderNumber" AS v FROM orders WHERE "orderNumber" ~ '^SIP[0-9]{10}$'
  UNION ALL SELECT 'SVK', "shipmentNo" FROM shipments WHERE "shipmentNo" ~ '^SVK[0-9]{10}$'
  UNION ALL SELECT 'CV', "sackNo" FROM sacks WHERE "sackNo" ~ '^CV[0-9]{10}$')
SELECT p, substr(v,length(p)+1,6) AS gun, min(substr(v,length(p)+7)::int) AS ilk, max(substr(v,length(p)+7)::int) AS son, count(*) AS adet
FROM k GROUP BY 1,2 HAVING min(substr(v,length(p)+7)::int)<>1 ORDER BY 1,2;
\echo '=== V2-Q31 belge no gunu <> kaydin gercek gunu (TZ kaymasi) ==='
SELECT 'orders' AS t, "orderNumber" AS no, to_char("createdAt" AT TIME ZONE 'Europe/Istanbul','DDMMYY') AS gercek_gun, substr("orderNumber",4,6) AS no_gun
FROM orders WHERE "orderNumber" ~ '^SIP[0-9]{10}$' AND substr("orderNumber",4,6) <> to_char("createdAt" AT TIME ZONE 'Europe/Istanbul','DDMMYY')
UNION ALL SELECT 'shipments', "shipmentNo", to_char("createdAt" AT TIME ZONE 'Europe/Istanbul','DDMMYY'), substr("shipmentNo",4,6)
FROM shipments WHERE "shipmentNo" ~ '^SVK[0-9]{10}$' AND substr("shipmentNo",4,6) <> to_char("createdAt" AT TIME ZONE 'Europe/Istanbul','DDMMYY')
UNION ALL SELECT 'sacks', "sackNo", to_char("createdAt" AT TIME ZONE 'Europe/Istanbul','DDMMYY'), substr("sackNo",3,6)
FROM sacks WHERE "sackNo" ~ '^CV[0-9]{10}$' AND substr("sackNo",3,6) <> to_char("createdAt" AT TIME ZONE 'Europe/Istanbul','DDMMYY');
\echo '=== V2-Q32 tombstone (mergedIntoId) musteriye bagli siparis/sevkiyat/cuval/iade ==='
SELECT 'orders' AS t, count(*) FROM orders o JOIN customers c ON c.id=o."customerId" WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'shipments', count(*) FROM shipments s JOIN customers c ON c.id=s."customerId" WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'sacks', count(*) FROM sacks s JOIN customers c ON c.id=s."customerId" WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'roll_returns', count(*) FROM roll_returns r JOIN customers c ON c.id=r."customerId" WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'order_lines->items', count(*) FROM order_lines ol JOIN items i ON i.id=ol."itemId" WHERE i."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'order_lines->colors', count(*) FROM order_lines ol JOIN colors c ON c.id=ol."colorId" WHERE c."mergedIntoId" IS NOT NULL;
\echo '=== V2-Q32b tombstone musteri sayisi (bilgi) ==='
SELECT count(*) FILTER (WHERE "mergedIntoId" IS NOT NULL) AS tombstone, count(*) FROM customers;
\echo '=== V2-Q33 branchId tutarliligi: sevkiyat vs siparis ==='
SELECT sh."shipmentNo", sh."branchId", o."orderNumber", o."branchId"
FROM shipment_orders so JOIN shipments sh ON sh.id=so."shipmentId" JOIN orders o ON o.id=so."orderId"
WHERE sh."customerId"<>o."customerId" OR (sh."branchId" IS DISTINCT FROM o."branchId" AND sh."branchId" IS NOT NULL AND o."branchId" IS NOT NULL);
\echo '=== V2-Q33b cuval branch/musteri vs sevkiyat ==='
SELECT sk."sackNo", sk."customerId"=sh."customerId" AS musteri_ok, sk."branchId" IS NOT DISTINCT FROM sh."branchId" AS sube_ok
FROM sacks sk JOIN shipments sh ON sh.id=sk."shipmentId" WHERE sk."customerId" IS DISTINCT FROM sh."customerId" OR sk."branchId" IS DISTINCT FROM sh."branchId";
\echo '=== V2-Q34 iptal edilmis siparis hala AKTIF sevkiyat kumesinde ==='
SELECT o."orderNumber", o.status, sh."shipmentNo", sh.status, so."isActive"
FROM shipment_orders so JOIN orders o ON o.id=so."orderId" JOIN shipments sh ON sh.id=so."shipmentId"
WHERE o.status='CANCELLED' AND sh.status IN ('PLANNED','DISPATCHED');
\echo '=== V2-Q35 BRUT kurali: irsaliye snapshot metraji vs canli icerik (iade sonrasi) ==='
SELECT sh."shipmentNo", (pd.snapshot->'doc'->'totals'->>'totalMeters')::numeric AS snapshot_m,
  (SELECT COALESCE(SUM(r."currentQty"),0) FROM rolls r JOIN sacks sk ON sk.id=r."sackId" WHERE sk."shipmentId"=sh.id) AS canli_m,
  (SELECT COALESCE(SUM(rr.qty),0) FROM roll_returns rr WHERE rr."fromShipmentId"=sh.id AND rr."cancelledAt" IS NULL) AS iade_m
FROM shipments sh JOIN printed_documents pd ON pd."sourceId"=sh.id AND pd."docType"='SHIPMENT_DISPATCH' AND pd.status='ACTIVE'
WHERE sh.status='DISPATCHED'
ORDER BY 1;
\echo '=== V2-Q36 refakat karti defter kapsami: surum > defter satiri ==='
SELECT tc."cardNumber", tc.version, tc.status, (SELECT count(*) FROM printed_documents pd WHERE pd."docType"='TRAVELER_CARD' AND pd."sourceId"=tc.id) AS defter
FROM traveler_cards tc WHERE tc.version > (SELECT count(*) FROM printed_documents pd WHERE pd."docType"='TRAVELER_CARD' AND pd."sourceId"=tc.id) AND tc.version>1;
\echo '=== V2-Q37 cuval etiketi bayat (labelDirty) dagilimi ==='
SELECT sh.status AS sevk, sk."labelDirty", count(*) FROM sacks sk LEFT JOIN shipments sh ON sh.id=sk."shipmentId" GROUP BY 1,2 ORDER BY 1,2;
\echo '=== V2-Q38 sevk edilmis cuvalda kartela + top karisimi / kartela sevkiyati ==='
SELECT sk."sackNo", (SELECT count(*) FROM rolls r WHERE r."sackId"=sk.id) AS top, (SELECT count(*) FROM swatches w WHERE w."sackId"=sk.id) AS kartela
FROM sacks sk WHERE (SELECT count(*) FROM rolls r WHERE r."sackId"=sk.id)>0 AND (SELECT count(*) FROM swatches w WHERE w."sackId"=sk.id)>0;
\echo '=== V2-Q39 tartisiz sevk edilmis cuval (bilgi) ==='
SELECT sh.destination, count(*) FILTER (WHERE sk."weightKg" IS NULL OR sk."weightKg"=0) AS tartisiz, count(*) AS toplam
FROM sacks sk JOIN shipments sh ON sh.id=sk."shipmentId" WHERE sh.status='DISPATCHED' GROUP BY 1;
