-- =============================================================================
-- BULGU-T1-005 — K2 fiili ihlal sorgusu (SALT-OKUNUR)
-- Fason KISMİ kabulde aynı clientToken eşzamanlı gelince idempotent replay
-- yerine "Barkod üretimi 5 denemede başarısız oldu" 409'u dönüyor; operatör
-- kabulü ELLE yeniden girince (yeni token) aynı teslimat İKİ kez düşülüyor.
-- Koşum: audit/tools/sql-saha.sh -f audit/data/BULGU-T1-005.sql
--        audit/tools/sql-dev.sh  -f audit/data/BULGU-T1-005.sql
-- =============================================================================

\echo '=== §1 MARUZİYET: fason kabul hacmi, token taşıyan kabul, kısmi kalem ==='
SELECT
  (SELECT count(*) FROM subcontractor_receipts)                            AS makbuz_toplam,
  (SELECT count(*) FROM subcontractor_receipts WHERE "cancelledAt" IS NULL) AS makbuz_aktif,
  (SELECT count(*) FROM subcontractor_receipts WHERE "clientToken" IS NOT NULL) AS token_tasiyan,
  (SELECT count(*) FROM subcontractor_receipt_items)                       AS kalem_toplam,
  (SELECT count(*) FROM subcontractor_receipt_items WHERE "isPartial")     AS kalem_kismi,
  (SELECT count(DISTINCT "receiptId") FROM subcontractor_receipt_items WHERE "isPartial") AS kismi_makbuz;

\echo ''
\echo '=== §2 ZAMAN PENCERESİ: kısmi kabul yolu ne zaman açıldı / son kabul ne zaman ==='
SELECT
  min("createdAt")::date AS ilk_kabul,
  max("createdAt")::date AS son_kabul,
  min("createdAt") FILTER (WHERE "clientToken" IS NOT NULL) AS ilk_tokenli_kabul,
  max("createdAt") FILTER (WHERE "clientToken" IS NOT NULL) AS son_tokenli_kabul
FROM subcontractor_receipts;

\echo ''
\echo '=== §3 İHLAL İMZASI A — aynı (WO, adım, firma) üzerinde 60 sn içinde iki AKTİF makbuz'
\echo '    ("yanıltıcı 409 → operatör elle yeniden girdi" imzası) ==='
SELECT a.id AS makbuz_1, b.id AS makbuz_2, a."receiptNo" AS fis_1, b."receiptNo" AS fis_2,
       a."workOrderId", a."stepId",
       (b."createdAt" - a."createdAt") AS fark,
       (a."clientToken" IS NOT NULL) AS a_tokenli, (b."clientToken" IS NOT NULL) AS b_tokenli
FROM subcontractor_receipts a
JOIN subcontractor_receipts b
  ON b."workOrderId" = a."workOrderId"
 AND b."stepId"      = a."stepId"
 AND b."subcontractorId" = a."subcontractorId"
 AND b."createdAt" > a."createdAt"
 AND b."createdAt" - a."createdAt" < interval '60 seconds'
WHERE a."cancelledAt" IS NULL AND b."cancelledAt" IS NULL
ORDER BY a."createdAt" DESC
LIMIT 20;

\echo ''
\echo '=== §4 İHLAL İMZASI B — AYNI top iki AKTİF makbuzda ve kabul toplamı topun'
\echo '    başlangıç metrajını AŞIYOR (çift düşülen teslimat) ==='
SELECT i."newRollId" AS roll_id, r.barcode,
       count(DISTINCT i."receiptId") AS aktif_makbuz,
       sum(i."receivedQty")          AS kabul_toplam,
       r."initialQty", r."currentQty", r.status
FROM subcontractor_receipt_items i
JOIN subcontractor_receipts rc ON rc.id = i."receiptId" AND rc."cancelledAt" IS NULL
JOIN rolls r ON r.id = i."newRollId"
WHERE i."receivedQty" IS NOT NULL
GROUP BY i."newRollId", r.barcode, r."initialQty", r."currentQty", r.status
HAVING sum(i."receivedQty") > r."initialQty"
ORDER BY sum(i."receivedQty") - r."initialQty" DESC
LIMIT 20;

\echo ''
\echo '=== §5 İHLAL İMZASI C — aynı top birden çok AKTİF makbuzda (kısmi teslimat'
\echo '    MEŞRU olabilir; §4 ile birlikte okunur) ==='
SELECT count(*) AS cok_makbuzlu_top FROM (
  SELECT i."newRollId"
  FROM subcontractor_receipt_items i
  JOIN subcontractor_receipts rc ON rc.id = i."receiptId" AND rc."cancelledAt" IS NULL
  GROUP BY i."newRollId"
  HAVING count(DISTINCT i."receiptId") > 1
) t;

\echo ''
\echo '=== §6 KARŞILAŞTIRMA: aynı korumanın UYGULANDIĞI yollarda token hacmi'
\echo '    (yol ölü değil — token sözleşmesi sahada fiilen kullanılıyor) ==='
SELECT 'orders'          AS tablo, count(*) AS toplam, count("clientToken") AS tokenli FROM orders
UNION ALL SELECT 'work_orders',  count(*), count("clientToken") FROM work_orders
UNION ALL SELECT 'rolls',        count(*), count("clientToken") FROM rolls
UNION ALL SELECT 'sacks',        count(*), count("clientToken") FROM sacks
UNION ALL SELECT 'shipments',    count(*), count("clientToken") FROM shipments
UNION ALL SELECT 'subcontractor_receipts', count(*), count("clientToken") FROM subcontractor_receipts;
