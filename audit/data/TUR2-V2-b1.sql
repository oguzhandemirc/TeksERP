\echo '=== V2-Q01 OL.shippedQty defter mutabakati (DISPATCHED + DSA) ==='
WITH led AS (
  SELECT ol.id, ol."orderId", ol.quantity, ol."shippedQty",
    COALESCE((SELECT SUM(sa.qty) FROM sack_allocations sa JOIN sacks sk ON sk.id=sa."sackId" JOIN shipments sh ON sh.id=sk."shipmentId"
              WHERE sa."orderLineId"=ol.id AND sh.status='DISPATCHED'),0)
  + COALESCE((SELECT SUM(d.qty) FROM subcontractor_direct_ship_allocations d WHERE d."orderLineId"=ol.id),0) AS defter
  FROM order_lines ol)
SELECT id, "orderId", quantity, "shippedQty", defter, "shippedQty"-defter AS fark FROM led WHERE abs("shippedQty"-defter) > 0.0005;

\echo '=== V2-Q02 Order.shippedQty = SUM(OL.shippedQty) ==='
SELECT o.id, o."orderNumber", o."shippedQty", COALESCE(SUM(ol."shippedQty"),0) AS kalem_toplam
FROM orders o LEFT JOIN order_lines ol ON ol."orderId"=o.id
GROUP BY o.id,o."orderNumber",o."shippedQty" HAVING abs(o."shippedQty"-COALESCE(SUM(ol."shippedQty"),0)) > 0.0005;

\echo '=== V2-Q03 sevk > istenen (asim) ==='
SELECT ol.id, o."orderNumber", ol.quantity, ol."shippedQty", ol."shippedQty"-ol.quantity AS fazla
FROM order_lines ol JOIN orders o ON o.id=ol."orderId" WHERE ol."shippedQty" > ol.quantity + 0.0005;

\echo '=== V2-Q04 sevk + PLANNED tahsis > istenen ==='
SELECT ol.id, o."orderNumber", ol.quantity, ol."shippedQty",
  COALESCE(SUM(sa.qty) FILTER (WHERE sh.status='PLANNED'),0) AS planli
FROM order_lines ol JOIN orders o ON o.id=ol."orderId"
LEFT JOIN sack_allocations sa ON sa."orderLineId"=ol.id
LEFT JOIN sacks sk ON sk.id=sa."sackId" LEFT JOIN shipments sh ON sh.id=sk."shipmentId"
GROUP BY ol.id,o."orderNumber",ol.quantity,ol."shippedQty"
HAVING ol."shippedQty"+COALESCE(SUM(sa.qty) FILTER (WHERE sh.status='PLANNED'),0) > ol.quantity + 0.0005;

\echo '=== V2-Q05 Order.status turetilmis degerden sapiyor (tolerans dahil) ==='
WITH tol AS (SELECT COALESCE((SELECT (value #>> '{}')::numeric FROM system_settings WHERE key='shipping.toleranceMeters'),5) AS t),
agg AS (SELECT o.id,o."orderNumber",o.status::text AS kayitli, SUM(ol.quantity) AS istenen, SUM(ol."shippedQty") AS sevk
        FROM orders o JOIN order_lines ol ON ol."orderId"=o.id
        WHERE o.status<>'CANCELLED' AND o."manualClosedById" IS NULL GROUP BY 1,2,3)
SELECT a.*, CASE WHEN a.sevk<=0 THEN (CASE WHEN a.kayitli='PENDING' THEN 'PENDING' ELSE 'APPROVED' END)
                 WHEN a.istenen-a.sevk <= (SELECT t FROM tol) THEN 'COMPLETED' ELSE 'PARTIAL_SHIPPED' END AS beklenen
FROM agg a WHERE a.kayitli <> CASE WHEN a.sevk<=0 THEN (CASE WHEN a.kayitli='PENDING' THEN 'PENDING' ELSE 'APPROVED' END)
                 WHEN a.istenen-a.sevk <= (SELECT t FROM tol) THEN 'COMPLETED' ELSE 'PARTIAL_SHIPPED' END;

\echo '=== V2-Q06 kalemsiz siparis (bilgi) ==='
SELECT o.id,o."orderNumber",o.status FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol."orderId"=o.id);

\echo '=== V2-Q07 shipment_orders.isActive <-> shipment PLANNED ==='
SELECT so."shipmentId", so."orderId", so."isActive", sh.status FROM shipment_orders so JOIN shipments sh ON sh.id=so."shipmentId"
WHERE so."isActive" <> (sh.status='PLANNED');

\echo '=== V2-Q08 DISPATCHED sevkiyat ama SackAllocation yok ==='
SELECT sh.id, sh."shipmentNo", sh."dispatchedAt", (SELECT count(*) FROM sacks sk WHERE sk."shipmentId"=sh.id) AS cuval
FROM shipments sh WHERE sh.status='DISPATCHED'
AND NOT EXISTS (SELECT 1 FROM sacks sk JOIN sack_allocations sa ON sa."sackId"=sk.id WHERE sk."shipmentId"=sh.id);

\echo '=== V2-Q09 PLANNED sevkiyat ama toplar SHIPPED ==='
SELECT sh."shipmentNo", sh.status, r.id, r.barcode, r.status FROM shipments sh JOIN sacks sk ON sk."shipmentId"=sh.id
JOIN rolls r ON r."sackId"=sk.id WHERE sh.status<>'DISPATCHED' AND r.status='SHIPPED';

\echo '=== V2-Q10 SHIPPED top hicbir DISPATCHED sevkiyatta degil ==='
SELECT r.id,r.barcode,r."sackId",r."shipmentId",sh.status FROM rolls r LEFT JOIN shipments sh ON sh.id=r."shipmentId"
WHERE r.status='SHIPPED' AND (r."shipmentId" IS NULL OR sh.status<>'DISPATCHED');

\echo '=== V2-Q11 ayni cuval iki sevkiyatta / top-cuval-sevk uclusu ==='
SELECT r.id,r.barcode,r."sackId",r."shipmentId",sk."shipmentId" AS cuval_sevk FROM rolls r JOIN sacks sk ON sk.id=r."sackId"
WHERE r."shipmentId" IS DISTINCT FROM sk."shipmentId";

\echo '=== V2-Q12 bos cuval (icerik yok) ==='
SELECT sk.id, sk."sackNo", sk."shipmentId", sh.status AS sevk, sk."createdAt"::date, sk."weightKg"
FROM sacks sk LEFT JOIN shipments sh ON sh.id=sk."shipmentId"
WHERE NOT EXISTS (SELECT 1 FROM rolls r WHERE r."sackId"=sk.id) AND NOT EXISTS (SELECT 1 FROM swatches w WHERE w."sackId"=sk.id);

\echo '=== V2-Q13 cuvalda karisik statu (SHIPPED + WAREHOUSE) ==='
SELECT sk."sackNo", sh.status AS sevk, string_agg(DISTINCT r.status::text,',') AS statuler, count(*) 
FROM sacks sk LEFT JOIN shipments sh ON sh.id=sk."shipmentId" JOIN rolls r ON r."sackId"=sk.id
GROUP BY sk.id,sk."sackNo",sh.status HAVING count(DISTINCT r.status) > 1;

\echo '=== V2-Q14 cuval tahsis toplami > brut icerik ==='
SELECT sk."sackNo", SUM(sa.qty) AS tahsis,
 (SELECT COALESCE(SUM(r."currentQty"),0) FROM rolls r WHERE r."sackId"=sk.id AND r.status NOT IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR','SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED'))
+(SELECT COALESCE(SUM(rr.qty),0) FROM roll_returns rr WHERE rr."prevSackId"=sk.id AND rr."cancelledAt" IS NULL) AS brut
FROM sack_allocations sa JOIN sacks sk ON sk.id=sa."sackId" GROUP BY sk.id,sk."sackNo"
HAVING SUM(sa.qty) > (SELECT COALESCE(SUM(r."currentQty"),0) FROM rolls r WHERE r."sackId"=sk.id AND r.status NOT IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR','SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED'))
+(SELECT COALESCE(SUM(rr.qty),0) FROM roll_returns rr WHERE rr."prevSackId"=sk.id AND rr."cancelledAt" IS NULL) + 0.001;

\echo '=== V2-Q15 tahsis sevkiyatin siparis kumesi disinda ==='
SELECT sa.id, sk."sackNo", ol."orderId", sk."shipmentId" FROM sack_allocations sa JOIN sacks sk ON sk.id=sa."sackId" JOIN order_lines ol ON ol.id=sa."orderLineId"
WHERE sk."shipmentId" IS NULL OR NOT EXISTS (SELECT 1 FROM shipment_orders so WHERE so."shipmentId"=sk."shipmentId" AND so."orderId"=ol."orderId");
