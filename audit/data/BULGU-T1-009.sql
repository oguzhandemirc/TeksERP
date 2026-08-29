-- =============================================================================
-- BULGU-T1-009 — K2 fiili ihlal sorguları
-- "İş emri iptali fason sevkini kapatamazsa fasondaki mal HAM STOĞA düşer ve
--  açık sevk ortada kalır"
-- SALT-OKUNUR. Koşulur: audit/tools/sql-saha.sh -f audit/data/BULGU-T1-009.sql
--                      audit/tools/sql-dev.sh  -f audit/data/BULGU-T1-009.sql
-- =============================================================================

\echo '=== S1: AÇIK+OUTSTANDING sevk kaleminin toplarının statü kırılımı ==='
-- Sağlıklı sistemde HEPSİ AT_SUBCONTRACTOR olmalıdır. STOCK/WAREHOUSE/A1_STOCK
-- görünen her satır bu bulgunun FİİLİ İHLALİDİR (mal dışarıda ama içeride sayılıyor).
SELECT r.status, count(*) AS adet, round(sum(r."currentQty"),2) AS metraj
FROM rolls r
JOIN subcontractor_dispatch_items di ON di."rollId" = r.id
JOIN subcontractor_dispatches d       ON d.id = di."dispatchId"
WHERE d."cancelledAt" IS NULL
  AND d."directShippedAt" IS NULL
  AND di."remainderClosedAt" IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM subcontractor_receipt_items ri
        JOIN subcontractor_receipts rc ON rc.id = ri."receiptId"
        WHERE ri."sourceDispatchItemId" = di.id
          AND ri."isPartial" = false
          AND rc."cancelledAt" IS NULL)
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== S2: İHLAL — açık+outstanding sevkin topu artık fasonda DEĞİL (örnek kayıtlar) ==='
SELECT r.id AS roll_id, r.status, r."currentQty", d."dispatchNo", w."workOrderNumber", w.status AS wo_status
FROM rolls r
JOIN subcontractor_dispatch_items di ON di."rollId" = r.id
JOIN subcontractor_dispatches d       ON d.id = di."dispatchId"
JOIN work_orders w                    ON w.id = d."workOrderId"
WHERE d."cancelledAt" IS NULL
  AND d."directShippedAt" IS NULL
  AND di."remainderClosedAt" IS NULL
  AND r.status NOT IN ('AT_SUBCONTRACTOR','SUBCONTRACTOR_CONSUMED')
  AND NOT EXISTS (
        SELECT 1 FROM subcontractor_receipt_items ri
        JOIN subcontractor_receipts rc ON rc.id = ri."receiptId"
        WHERE ri."sourceDispatchItemId" = di.id
          AND ri."isPartial" = false
          AND rc."cancelledAt" IS NULL)
ORDER BY 1 LIMIT 20;

\echo ''
\echo '=== S3: MARUZİYET — İPTAL EDİLMİŞ iş emrine bağlı AÇIK+OUTSTANDING sevk ==='
-- Bu yol koştuysa (cancelBulk düştüyse) burada satır kalır: iptal WO + açık sevk.
SELECT w."workOrderNumber", w.status AS wo_status, w."cancelledAt", d."dispatchNo", d."cancelledAt" AS d_cancelled
FROM subcontractor_dispatches d
JOIN work_orders w ON w.id = d."workOrderId"
WHERE w.status IN ('CANCELLED','SUPERSEDED')
  AND d."cancelledAt" IS NULL
  AND d."directShippedAt" IS NULL
  AND EXISTS (
        SELECT 1 FROM subcontractor_dispatch_items di
        WHERE di."dispatchId" = d.id
          AND di."remainderClosedAt" IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM subcontractor_receipt_items ri
                JOIN subcontractor_receipts rc ON rc.id = ri."receiptId"
                WHERE ri."sourceDispatchItemId" = di.id
                  AND ri."isPartial" = false
                  AND rc."cancelledAt" IS NULL))
ORDER BY w."cancelledAt" DESC LIMIT 20;

\echo ''
\echo '=== S4: MARUZİYET TABANI — kısmi kabul (isPartial=true) sayısı + iptal WO sayısı ==='
SELECT
  (SELECT count(*) FROM subcontractor_receipt_items WHERE "isPartial") AS kismi_kabul_kalemi,
  (SELECT count(*) FROM subcontractor_receipts WHERE "cancelledAt" IS NULL) AS aktif_makbuz,
  (SELECT count(*) FROM work_orders WHERE status='CANCELLED') AS iptal_wo,
  (SELECT count(*) FROM work_orders WHERE status='CANCELLED' AND "cancelledAt" >= '2026-08-17') AS iptal_wo_ozellik_sonrasi,
  (SELECT count(*) FROM subcontractor_dispatches WHERE "cancelledAt" IS NULL) AS acik_sevk;

\echo ''
\echo '=== S5: İptal edilmiş WO adımında STOCK''a çekilmiş, sevk kalemi olan toplar ==='
-- Bulgunun kalıcı izi: top STOCK, currentStepId=NULL (blanket updateMany), ama
-- iptal EDİLMEMİŞ bir sevk kaleminde adı geçiyor.
SELECT r.id AS roll_id, r.status, r."currentStepId", d."dispatchNo", d."cancelledAt" AS d_cancelled,
       w."workOrderNumber", w.status AS wo_status
FROM rolls r
JOIN subcontractor_dispatch_items di ON di."rollId" = r.id
JOIN subcontractor_dispatches d       ON d.id = di."dispatchId"
JOIN work_orders w                    ON w.id = d."workOrderId"
WHERE r.status = 'STOCK' AND d."cancelledAt" IS NULL
ORDER BY 1 LIMIT 20;
