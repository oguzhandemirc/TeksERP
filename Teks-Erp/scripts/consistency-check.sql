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
-- ⚠️ MEKANİK İKİZİ VAR: `scripts/test_consistency.ts` aşağıdaki sorguları AYNEN
--    koşar ve her bölümü bir check()'e bağlar → `npm test` ile otomatik, drift =
--    KIRMIZI. Gerekçe: `psql` HER durumda `exit 0` verir, yani bu dosyayı elle
--    koşmak "sorunlu satırları" basar ama hiçbir otomasyon farkı göremez.
--    Bu dosya operatörün satırları GÖZLE görmesi için duruyor. Bir bölümün mantığı
--    değişecekse ÖNCE burada değişir, sonra test'e kopyalanır (iki yüzey tek gerçek).
--    Test ayrıca burada olmayan bir §20 taşır: WorkOrderStep.status mutabakatı.
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

-- =============================================================================
-- §8-§19: 2026-07-31 veri bütünlüğü denetimi eklemeleri (Bölüm E —
-- docs/audit/VERI-BUTUNLUGU-RAPORU-2026-07-31.md). Tümü salt-okunur.
-- =============================================================================

\echo ''
\echo '== 8) Barkodsuz satılabilir top (WAREHOUSE/A1_STOCK ama barcode NULL) =='
\echo '   (satır varsa: finalize/kapanış dispozisyonu barkod atamayı atlamış)'
SELECT id, status, "currentQty", "updatedAt"
FROM rolls
WHERE status IN ('WAREHOUSE','A1_STOCK') AND barcode IS NULL;

\echo ''
\echo '== 9) SHIPPED top ama çuvalı yok / çuvalın sevkiyatı DISPATCHED değil =='
SELECT r.id, r.barcode, r.status, r."sackId", s."shipmentId", sh.status AS sevk_durumu
FROM rolls r
LEFT JOIN sacks s ON s.id = r."sackId"
LEFT JOIN shipments sh ON sh.id = s."shipmentId"
WHERE r.status = 'SHIPPED'
  AND (r."sackId" IS NULL OR sh.status IS DISTINCT FROM 'DISPATCHED');

\echo ''
\echo '== 10) IN_PRODUCTION top ama currentStepId NULL veya WO CANCELLED/SUPERSEDED =='
\echo '   ("canlı ama okutulamayan" top — çıkanlar süpervizör "Kurtar" adayıdır)'
SELECT r.id, r.barcode, r.status, r."currentStepId", wos."workOrderId", wo.status AS wo_durumu
FROM rolls r
LEFT JOIN work_order_steps wos ON wos.id = r."currentStepId"
LEFT JOIN work_orders wo ON wo.id = wos."workOrderId"
WHERE r.status = 'IN_PRODUCTION'
  AND (r."currentStepId" IS NULL OR wo.id IS NULL OR wo.status IN ('CANCELLED','SUPERSEDED'));

\echo ''
\echo '== 11) Açık movement + top artık orada değil / ölü statüde (hayalet movement) =='
SELECT rm.id AS movement_id, rm."rollId", r.barcode, r.status AS top_durumu,
       rm."workOrderStepId", r."currentStepId", rm."enteredAt"
FROM roll_movements rm
JOIN rolls r ON r.id = rm."rollId"
WHERE rm."exitedAt" IS NULL
  AND (r.status IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED')
       OR r."currentStepId" IS DISTINCT FROM rm."workOrderStepId");

\echo ''
\echo '== 12) Kapanmış movement''ta qtyOut <> qtyIn =='
\echo '   (kural: qtyOut = qtyIn — commit 64263fc, 2026-07-30. O tarihten ÖNCEKİ'
\echo '    satırlar bilinen kalıntı olabilir; exitedAt dağılımına göre ayır.)'
SELECT rm.id, rm."rollId", rm."workOrderStepId", rm."qtyIn", rm."qtyOut", rm."exitedAt"
FROM roll_movements rm
WHERE rm."exitedAt" IS NOT NULL
  AND rm."qtyOut" IS DISTINCT FROM rm."qtyIn"
ORDER BY rm."exitedAt" DESC;

\echo ''
\echo '== 13) currentQty > initialQty (top yalnız kesimle azalır, artamaz) =='
\echo '   KÖK NEDEN 2026-08-22de kapandı (tambur-undo applySingle canlı dalında aşım'
\echo '   koruması yoktu). Canlıdaki 2 eski satır BİLEREK düzeltilmedi — toplu UPDATE'
\echo '   kök nedeni gizler; bu bölüm onları görünür tutar.'
SELECT id, barcode, "initialQty", "currentQty", status
FROM rolls
WHERE "currentQty" > "initialQty";

\echo ''
\echo '== 14) Yarım fason kabul (top tüketildi ama receipt''ten çocuk doğmamış) =='
SELECT r.id AS tuketilen_top_id, r.barcode, r."updatedAt",
       sr.id AS receipt_id, sr."receiptNo"
FROM rolls r
JOIN subcontractor_receipt_items sri ON sri."newRollId" = r.id
JOIN subcontractor_receipts sr ON sr.id = sri."receiptId" AND sr."cancelledAt" IS NULL
WHERE r.status = 'SUBCONTRACTOR_CONSUMED'
  AND NOT EXISTS (SELECT 1 FROM rolls child WHERE child."parentReceiptId" = sr.id);

\echo ''
\echo '== 15) AT_SUBCONTRACTOR top ama açık fason sevk kaydı yok =='
\echo '   (NOT: seed''li DEV ortamında yanlış pozitif — seed statüyü dispatch''siz yazar;'
\echo '    üretimde her satır gerçek anomalidir)'
SELECT r.id, r.barcode, r."updatedAt"
FROM rolls r
WHERE r.status = 'AT_SUBCONTRACTOR'
  AND NOT EXISTS (
    SELECT 1 FROM subcontractor_dispatch_items sdi
    JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
    WHERE sdi."rollId" = r.id AND sd."cancelledAt" IS NULL
  );

\echo ''
\echo '== 16) Kartsız iş emri (kart WO açılışında doğar — 2026-07-14 sonrası) =='
\echo '   (workorder.service.create tx''i kartı koşulsuz doğurur; satır çıkması ya'
\echo '    doğrudan-SQL/restore artığı ya da yeni bir kart-atlama yoludur)'
SELECT wo.id, wo."workOrderNumber", wo.status, wo."createdAt"
FROM work_orders wo
LEFT JOIN traveler_cards tc ON tc."workOrderId" = wo.id
WHERE tc.id IS NULL
  AND wo."createdAt" >= '2026-07-14';  -- kart-redesign cutover; öncesi legacy

\echo ''
\echo '== 17) Açık (isProcessed=false) RollError ama top ölü/emekli statüde =='
SELECT re.id AS hata_id, re."rollId", r.barcode, r.status, re."detectedAt"
FROM roll_errors re
JOIN rolls r ON r.id = re."rollId"
WHERE re."isProcessed" = false
  AND r.status IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED','SCRAP');

\echo ''
\echo '== 18) Master-data ad mükerrer (aktif, case/boşluk-duyarsız) =='
\echo '   (customers/items/subcontractors: DB partial UNIQUE VAR — nameFold, mergedIntoId IS NULL,'
\echo '    2026-08-21; bu satır orada GEVŞEK ayna. colors/routes: app-level guard, yalnız GÖZLEM;'
\echo '    otomatik birleştirme/silme ÖNERİLMEZ)'
SELECT 'items' AS tablo, lower(trim(name)) AS ad, COUNT(*) AS adet, array_agg(id) AS kayitlar
FROM items WHERE "isActive" = true GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL
SELECT 'colors', lower(trim(name)), COUNT(*), array_agg(id)
FROM colors WHERE "isActive" = true GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL
SELECT 'customers', lower(trim(name)), COUNT(*), array_agg(id)
FROM customers WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL
SELECT 'subcontractors', lower(trim(name)), COUNT(*), array_agg(id)
FROM subcontractors WHERE "isActive" = true GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL
SELECT 'routes', lower(trim(name)), COUNT(*), array_agg(id)
FROM routes GROUP BY 2 HAVING COUNT(*) > 1;
-- customers: birleştirme TOMBSTONE'u (mergedIntoId dolu) aynı adı meşru taşır ve
-- isActive süzgeci yok → tombstone süzülmezse her müşteri birleştirmesi §18'i kırmızı
-- yapar (2026-08-21'de ölçüldü). items/colors/subcontractors'ta isActive=true zaten dışlar.

\echo ''
\echo '== 19) Fason sevk / doğrudan-sevk snapshot toplamı vs kalem toplamı =='
SELECT 'subcontractor_dispatches' AS tablo, sd.id::text AS kayit, sd."totalQty" AS kayitli,
       COALESCE(SUM(sdi."dispatchedQty"), 0) AS hesaplanan
FROM subcontractor_dispatches sd
LEFT JOIN subcontractor_dispatch_items sdi ON sdi."dispatchId" = sd.id
GROUP BY sd.id, sd."totalQty"
HAVING sd."totalQty" <> COALESCE(SUM(sdi."dispatchedQty"), 0)
UNION ALL
SELECT 'direct_shipments', ds.id::text, ds."totalQty", COALESCE(SUM(dsa.qty), 0)
FROM direct_shipments ds
LEFT JOIN subcontractor_direct_ship_allocations dsa ON dsa."directShipmentId" = ds.id
GROUP BY ds.id, ds."totalQty"
HAVING ds."totalQty" <> COALESCE(SUM(dsa.qty), 0);

\echo ''
\echo '== Tutarlılık kontrolü bitti. Yukarıda hiç satır YOKSA sistem sağlıklı. =='
