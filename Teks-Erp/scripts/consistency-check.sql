-- =============================================================================
-- TeksERP — Veri Tutarlılık Kontrolü (consistency-check.sql)   [D-9]
-- =============================================================================
-- ÇUVAL HAVUZU MODELİ: shippedQty/packedQty denormalize alanları defter-otoritatiftir
-- (recomputeOrderFulfillment) ama DB seddi YOK — drift oluşursa karşılanma/MRP sessizce
-- yanlışlanır. Bu script onu yakalar.
--   shippedQty = Σ SackAllocation(çuval DISPATCHED) + Σ DirectShipAllocation
--   packedQty  = Σ SackAllocation(çuval havuzda VEYA PLANNED/AT_DOOR)
--
-- Ne zaman: 3 ayda bir (ARCHITECTURE.md §10.2 ile) veya şüphe anında. Salt-okunur.
-- Kullanım: psql <db> -f scripts/consistency-check.sql
-- Yorum:    Her bölüm SORUNLU satırları döndürür. TÜM bölümler boşsa sistem sağlıklı.
-- =============================================================================

\echo ''
\echo '== 1) OrderLine.shippedQty  vs  Σ(SackAllocation[DISPATCHED] + DirectShipAllocation) =='
\echo '   (satır varsa: sevk denormalize toplamı defterden kopmuş)'
SELECT ol.id AS order_line_id,
       ol."shippedQty" AS kayitli,
       COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0) AS hesaplanan,
       ol."shippedQty" - (COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0)) AS fark
FROM order_lines ol
LEFT JOIN (
  SELECT sal."orderLineId", SUM(sal.qty) AS toplam
  FROM sack_allocations sal
  JOIN sacks sk ON sk.id = sal."sackId"
  JOIN shipments sh ON sh.id = sk."shipmentId"
  WHERE sh.status = 'DISPATCHED'
  GROUP BY sal."orderLineId"
) sa ON sa."orderLineId" = ol.id
LEFT JOIN (SELECT "orderLineId", SUM(qty) AS toplam FROM subcontractor_direct_ship_allocations GROUP BY "orderLineId") dsa
       ON dsa."orderLineId" = ol.id
WHERE ol."shippedQty" <> COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0);

\echo ''
\echo '== 1b) OrderLine.packedQty  vs  Σ(SackAllocation[havuz VEYA PLANNED/AT_DOOR]) =='
\echo '   (satır varsa: çuvallanmış rezerv denormalize toplamı defterden kopmuş)'
SELECT ol.id AS order_line_id,
       ol."packedQty" AS kayitli,
       COALESCE(pa.toplam, 0) AS hesaplanan,
       ol."packedQty" - COALESCE(pa.toplam, 0) AS fark
FROM order_lines ol
LEFT JOIN (
  SELECT sal."orderLineId", SUM(sal.qty) AS toplam
  FROM sack_allocations sal
  JOIN sacks sk ON sk.id = sal."sackId"
  LEFT JOIN shipments sh ON sh.id = sk."shipmentId"
  WHERE sk."shipmentId" IS NULL OR sh.status IN ('PLANNED', 'AT_DOOR')
  GROUP BY sal."orderLineId"
) pa ON pa."orderLineId" = ol.id
WHERE ol."packedQty" <> COALESCE(pa.toplam, 0);

\echo ''
\echo '== 2) Order.shippedQty/packedQty  vs  Σ(OrderLine.*) =='
SELECT o.id AS order_id,
       o."shippedQty" AS shipped_kayitli, COALESCE(SUM(ol."shippedQty"), 0) AS shipped_hesap,
       o."packedQty"  AS packed_kayitli,  COALESCE(SUM(ol."packedQty"), 0)  AS packed_hesap
FROM orders o
LEFT JOIN order_lines ol ON ol."orderId" = o.id
GROUP BY o.id, o."shippedQty", o."packedQty"
HAVING o."shippedQty" <> COALESCE(SUM(ol."shippedQty"), 0)
    OR o."packedQty"  <> COALESCE(SUM(ol."packedQty"), 0);

\echo ''
\echo '== 3) Negatif miktar/metraj/kg  (CHECK backstop — normalde 0) =='
SELECT 'rolls' AS tablo, id::text AS kayit FROM rolls
  WHERE "currentQty" < 0 OR "initialQty" < 0 OR ("weightKg" IS NOT NULL AND "weightKg" < 0)
UNION ALL
SELECT 'order_lines', id::text FROM order_lines WHERE "quantity" <= 0 OR "shippedQty" < 0 OR "packedQty" < 0
UNION ALL
SELECT 'sack_allocations', id::text FROM sack_allocations WHERE qty <= 0;

\echo ''
\echo '== 4) Roll ↔ Sack ↔ Shipment tutarlılık  (O-22 FK backstop — normalde 0) =='
SELECT r.id AS roll_id, r."sackId", r."shipmentId" AS roll_shipment, s."shipmentId" AS sack_shipment
FROM rolls r
JOIN sacks s ON r."sackId" = s.id
WHERE r."shipmentId" IS DISTINCT FROM s."shipmentId";

\echo ''
\echo '== 5) shipment_orders.isActive  vs  shipment.status  (denorm drift) =='
\echo '   (satır varsa: isActive bayrağı bakımı bir sevkiyat geçişinde atlanmış)'
SELECT so."shipmentId", so."orderId", so."isActive" AS bayrak, s.status AS gercek_durum
FROM shipment_orders so
JOIN shipments s ON s.id = so."shipmentId"
WHERE so."isActive" <> (s.status IN ('PLANNED', 'AT_DOOR'));

\echo ''
\echo '== 6) Çuval havuzu invariant: mühürlü çuval boş olamaz / seq-shipmentId tutarlılığı =='
SELECT sk.id AS sack_id, sk."sealedAt", sk."shipmentId", sk.seq
FROM sacks sk
WHERE (sk."sealedAt" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rolls r WHERE r."sackId" = sk.id)
                                 AND NOT EXISTS (SELECT 1 FROM swatches sw WHERE sw."sackId" = sk.id))
   OR (sk."shipmentId" IS NULL AND sk.seq IS NOT NULL)      -- havuzda seq olmamalı
   OR (sk."shipmentId" IS NOT NULL AND sk.seq IS NULL);     -- sevkiyatta seq olmalı

\echo ''
\echo '== Tutarlılık kontrolü bitti. Yukarıda hiç satır YOKSA sistem sağlıklı. =='
