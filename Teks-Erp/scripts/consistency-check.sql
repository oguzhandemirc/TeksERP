-- =============================================================================
-- TeksERP — Veri Tutarlılık Kontrolü (consistency-check.sql)   [D-9]
-- =============================================================================
-- Denormalize alanların (shippedQty) MUTABAKATI + invariant taramaları. shippedQty
-- iki yazarlı (sevkiyat READY + fason direkt sevk) ve DB seviyesinde seddi YOK —
-- drift oluşursa sipariş karşılanma / MRP sessizce yanlışlanır. Bu script onu yakalar.
--
-- Ne zaman: 3 ayda bir (ARCHITECTURE.md §10.2 sağlık kontrolüyle birlikte) veya şüphe
--           anında. Salt-okunur; hiçbir veri değiştirmez.
-- Kullanım: psql <db> -f scripts/consistency-check.sql
-- Yorum:    Her bölüm SORUNLU satırları döndürür. TÜM bölümler boşsa sistem sağlıklı.
-- =============================================================================

\echo ''
\echo '== 1) OrderLine.shippedQty  vs  Σ(ShipmentAllocation + SubcontractorDirectShipAllocation) =='
\echo '   (satır varsa: denormalize sevk toplamı allocation defterinden kopmuş)'
SELECT ol.id AS order_line_id,
       ol."shippedQty" AS kayitli,
       COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0) AS hesaplanan,
       ol."shippedQty" - (COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0)) AS fark
FROM order_lines ol
LEFT JOIN (SELECT "orderLineId", SUM(qty) AS toplam FROM shipment_allocations GROUP BY "orderLineId") sa
       ON sa."orderLineId" = ol.id
LEFT JOIN (SELECT "orderLineId", SUM(qty) AS toplam FROM subcontractor_direct_ship_allocations GROUP BY "orderLineId") dsa
       ON dsa."orderLineId" = ol.id
WHERE ol."shippedQty" <> COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0);

\echo ''
\echo '== 2) Order.shippedQty  vs  Σ(OrderLine.shippedQty) =='
SELECT o.id AS order_id,
       o."shippedQty" AS kayitli,
       COALESCE(SUM(ol."shippedQty"), 0) AS hesaplanan,
       o."shippedQty" - COALESCE(SUM(ol."shippedQty"), 0) AS fark
FROM orders o
LEFT JOIN order_lines ol ON ol."orderId" = o.id
GROUP BY o.id, o."shippedQty"
HAVING o."shippedQty" <> COALESCE(SUM(ol."shippedQty"), 0);

\echo ''
\echo '== 3) Negatif miktar/metraj/kg  (O-5 CHECK backstop — normalde 0) =='
SELECT 'rolls' AS tablo, id::text AS kayit FROM rolls
  WHERE "currentQty" < 0 OR "initialQty" < 0 OR ("weightKg" IS NOT NULL AND "weightKg" < 0)
UNION ALL
SELECT 'order_lines', id::text FROM order_lines WHERE "quantity" <= 0 OR "shippedQty" < 0
UNION ALL
SELECT 'shipment_allocations', id::text FROM shipment_allocations WHERE qty <= 0;

\echo ''
\echo '== 4) Roll ↔ Sack ↔ Shipment tutarlılık  (O-22 FK backstop — normalde 0) =='
SELECT r.id AS roll_id, r."sackId", r."shipmentId" AS roll_shipment, s."shipmentId" AS sack_shipment
FROM rolls r
JOIN sacks s ON r."sackId" = s.id
WHERE r."shipmentId" IS DISTINCT FROM s."shipmentId";

\echo ''
\echo '== Tutarlılık kontrolü bitti. Yukarıda hiç satır YOKSA sistem sağlıklı. =='
