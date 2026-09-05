-- BULGU-T2-001: DISPATCHED sevkiyat içeriği vs sack_allocations mutabakatı
-- Q1: genel toplamlar (DISPATCHED)
SELECT
  count(*) AS dispatched_sevkiyat,
  sum(icerik) AS toplam_icerik_m,
  sum(tahsis) AS toplam_tahsis_m,
  sum(icerik - tahsis) AS toplam_defter_disi_m
FROM (
  SELECT sh.id,
    (SELECT coalesce(sum(r."currentQty"),0) FROM rolls r JOIN sacks s2 ON s2.id = r."sackId" WHERE s2."shipmentId" = sh.id) AS icerik,
    (SELECT coalesce(sum(sa.qty),0) FROM sack_allocations sa JOIN sacks s3 ON s3.id = sa."sackId" WHERE s3."shipmentId" = sh.id) AS tahsis
  FROM shipments sh WHERE sh.status = 'DISPATCHED'
) x;

-- Q2: kaç sevkiyatta fark var, ve içerik/tahsis 0 olan sevkiyatlar
SELECT sh."shipmentNo", x.icerik, x.tahsis, (x.icerik - x.tahsis) AS fark
FROM (
  SELECT sh.id,
    (SELECT coalesce(sum(r."currentQty"),0) FROM rolls r JOIN sacks s2 ON s2.id = r."sackId" WHERE s2."shipmentId" = sh.id) AS icerik,
    (SELECT coalesce(sum(sa.qty),0) FROM sack_allocations sa JOIN sacks s3 ON s3.id = sa."sackId" WHERE s3."shipmentId" = sh.id) AS tahsis
  FROM shipments sh WHERE sh.status = 'DISPATCHED'
) x
JOIN shipments sh ON sh.id = x.id
WHERE (x.icerik - x.tahsis) > 0.01
ORDER BY (x.icerik - x.tahsis) DESC;

-- Q3: tamamen tahsissiz (0 tahsis) DISPATCHED sevkiyatlar + top/metraj
SELECT sh."shipmentNo", sh."customerId", c.name AS musteri,
  (SELECT count(*) FROM rolls r JOIN sacks s2 ON s2.id = r."sackId" WHERE s2."shipmentId" = sh.id) AS top_adedi,
  (SELECT coalesce(sum(r."currentQty"),0) FROM rolls r JOIN sacks s2 ON s2.id = r."sackId" WHERE s2."shipmentId" = sh.id) AS icerik_m
FROM shipments sh
LEFT JOIN customers c ON c.id = sh."customerId"
WHERE sh.status = 'DISPATCHED'
  AND NOT EXISTS (SELECT 1 FROM sack_allocations sa JOIN sacks s3 ON s3.id = sa."sackId" WHERE s3."shipmentId" = sh.id)
ORDER BY sh."shipmentNo";

-- Q4: SIP1008260003 (ALP·55-BEYAZ·500m) kalem durumu + SVK1708260002 içeriği/renk uyuşmazlığı
SELECT o."orderNumber", ol.id AS lineId, i.name AS kumas, col.name AS renk, ol.width, ol.quantity, ol."shippedQty"
FROM order_lines ol
JOIN orders o ON o.id = ol."orderId"
JOIN items i ON i.id = ol."itemId"
LEFT JOIN colors col ON col.id = ol."colorId"
WHERE o."orderNumber" = 'SIP1008260003';

SELECT sh."shipmentNo", r.barcode, i.name AS kumas, col.name AS renk, r.width, r."currentQty"
FROM shipments sh
JOIN sacks s ON s."shipmentId" = sh.id
JOIN rolls r ON r."sackId" = s.id
JOIN items i ON i.id = r."itemId"
LEFT JOIN colors col ON col.id = r."colorId"
WHERE sh."shipmentNo" = 'SVK1708260002';

-- Q5: etkilenen kalemler (shippedQty=0 ama DISPATCHED sevkiyat kümesindeki içerikle spec eşleşen)
SELECT o."orderNumber", ol.id, i.name, col.name AS renk, ol.width, ol.quantity, ol."shippedQty"
FROM order_lines ol
JOIN orders o ON o.id = ol."orderId"
JOIN items i ON i.id = ol."itemId"
LEFT JOIN colors col ON col.id = ol."colorId"
WHERE ol.id IN ('335621b0-0000-0000-0000-000000000000') -- placeholder, gerçek id'ler Q6'dan
LIMIT 1;

-- Q6: id ön eki ile üç kalem (birebir spec eşleşmesi ama shippedQty=0)
SELECT o."orderNumber", ol.id, i.name, col.name AS renk, ol.width, ol.quantity, ol."shippedQty"
FROM order_lines ol
JOIN orders o ON o.id = ol."orderId"
JOIN items i ON i.id = ol."itemId"
LEFT JOIN colors col ON col.id = ol."colorId"
WHERE ol.id::text LIKE '335621b0%' OR ol.id::text LIKE '7606314a%' OR ol.id::text LIKE '1e70c8cf%';
