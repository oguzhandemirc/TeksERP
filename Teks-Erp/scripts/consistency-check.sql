-- =============================================================================
-- TeksERP — Veri Tutarlılık Kontrolü (consistency-check.sql)   [D-9]
-- =============================================================================
-- ÇUVAL DEPO MODELİ (2026-07): shippedQty denormalize alanı defter-otoritatiftir
-- (recomputeOrderStatusForOrders → computeLineLedger) ama DB seddi YOK — drift oluşursa
-- karşılanma/MRP sessizce yanlışlanır. Bu script onu yakalar.
--   shippedQty = Σ SackAllocation(çuval DISPATCHED) + Σ DirectShipAllocation
-- Rezerv/packedQty YOK (mühür + rebalance kaldırıldı) → düşüş yalnız sevkte. PLANNED
-- tahsis shippedQty'ye sayılmaz.
--
-- Ne zaman: 3 ayda bir (ARCHITECTURE.md §10.2 ile) veya şüphe anında. Salt-okunur.
--           §7 için EK OLARAK: kartela / tambur / fason akışına dokunan her sürümden
--           sonra (çuval üyeliği ile top statüsü ayrışabilir — bkz. §7 başlığı).
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
\echo '== 2) Order.shippedQty  vs  Σ(OrderLine.shippedQty) =='
SELECT o.id AS order_id,
       o."shippedQty" AS shipped_kayitli, COALESCE(SUM(ol."shippedQty"), 0) AS shipped_hesap
FROM orders o
LEFT JOIN order_lines ol ON ol."orderId" = o.id
GROUP BY o.id, o."shippedQty"
HAVING o."shippedQty" <> COALESCE(SUM(ol."shippedQty"), 0);

\echo ''
\echo '== 3) Negatif miktar/metraj/kg  (CHECK backstop — normalde 0) =='
SELECT 'rolls' AS tablo, id::text AS kayit FROM rolls
  WHERE "currentQty" < 0 OR "initialQty" < 0 OR ("weightKg" IS NOT NULL AND "weightKg" < 0)
UNION ALL
SELECT 'order_lines', id::text FROM order_lines WHERE "quantity" <= 0 OR "shippedQty" < 0
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
WHERE so."isActive" <> (s.status = 'PLANNED');

\echo ''
\echo '== 6) Çuval seq ↔ shipmentId tutarlılığı  (depoda seq YOK, sevkiyatta seq VAR) =='
SELECT sk.id AS sack_id, sk."shipmentId", sk.seq
FROM sacks sk
WHERE (sk."shipmentId" IS NULL AND sk.seq IS NOT NULL)      -- depoda seq olmamalı
   OR (sk."shipmentId" IS NOT NULL AND sk.seq IS NULL);     -- sevkiyatta seq olmalı

\echo ''
\echo '== 7) Çuvalda KAYITLI ama fiziksel olarak binada OLMAYAN top (HAYALET İÇERİK) =='
\echo '   (satır varsa: bir akış topu ÇUVALDAN ÇIKARMADAN başka yere aldı — kartela/tambur/fason)'
\echo '   Onarım: npx tsx scripts/repair_sack_ghost_rolls.ts  (rapor) / --apply (uygula)'
-- Kök neden: DEPO çuvalındaki topun `Roll.shipmentId`'si NULL'dır (shipmentId yalnız
-- createShipment anında yazılır) → "çuvalda mı?" sorusunu shipmentId ile soran guard
-- depo çuvalındaki topu SERBEST sanar. Statü kümesi = SACK_ABSENT_STATUSES
-- (src/services/helpers/sack-invariants.helper.ts) — SHIPPED bilinçli olarak YOK.
SELECT r.id AS roll_id, r.barcode, r.status, r."currentQty",
       s."sackNo", s."weightKg" AS cuval_kg,
       sh."shipmentNo", sh.status AS sevkiyat_durumu,
       r."updatedAt"
FROM rolls r
JOIN sacks s ON s.id = r."sackId"
LEFT JOIN shipments sh ON sh.id = s."shipmentId"
WHERE r.status IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR',
                   'SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED')
ORDER BY s."sackNo", r.barcode;

\echo ''
\echo '== 7b) SEVK EDİLMİŞ ama kartelaya/fasona DA gönderilmiş top  (GEÇMİŞ ÇİFT-SAYIM) =='
\echo '   (satır varsa: aynı mal müşteriye faturalandı VE dışarıya çıktı — irsaliye DONMUŞ,'
\echo '    geri alınamaz; düzeltme yalnız reissue ile İNSAN kararıdır)'
-- Neden ayrı bölüm: performDispatchTx statüyü SHIPPED'e ezdiği için §7 bunları
-- göstermez; kalıcı kanıt yalnız kartela/fason sevk kalemlerinde durur.
SELECT r.id AS roll_id, r.barcode, r."currentQty",
       s."sackNo", sh."shipmentNo", sh."dispatchedAt",
       kd."dispatchNo" AS kartela_sevk, NULL AS fason_sevk
FROM rolls r
JOIN sacks s ON s.id = r."sackId"
JOIN shipments sh ON sh.id = s."shipmentId" AND sh.status = 'DISPATCHED'
JOIN kartela_dispatch_items kdi ON kdi."rollId" = r.id
JOIN kartela_dispatches kd ON kd.id = kdi."dispatchId" AND kd."cancelledAt" IS NULL
WHERE r.status = 'SHIPPED'
UNION ALL
SELECT r.id, r.barcode, r."currentQty",
       s."sackNo", sh."shipmentNo", sh."dispatchedAt",
       NULL, sd."dispatchNo"
FROM rolls r
JOIN sacks s ON s.id = r."sackId"
JOIN shipments sh ON sh.id = s."shipmentId" AND sh.status = 'DISPATCHED'
JOIN subcontractor_dispatch_items sdi ON sdi."rollId" = r.id
JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId" AND sd."cancelledAt" IS NULL
WHERE r.status = 'SHIPPED'
ORDER BY 6 DESC NULLS LAST;

\echo ''
\echo '== 7c) İPTAL EDİLMİŞ kartela hâlâ çuvalda  (simetri kontrolü — normalde 0) =='
\echo '   (kartela.service iptalde sackId=null yazıyor; satır çıkarsa YENİ bir delik var)'
SELECT w.id AS swatch_id, w.barcode, s."sackNo", w."cancelledAt"
FROM swatches w
JOIN sacks s ON s.id = w."sackId"
WHERE w."cancelledAt" IS NOT NULL;

\echo ''
\echo '== Tutarlılık kontrolü bitti. Yukarıda hiç satır YOKSA sistem sağlıklı. =='
