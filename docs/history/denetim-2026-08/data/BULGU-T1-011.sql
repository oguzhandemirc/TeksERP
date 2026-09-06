-- =============================================================================
-- BULGU-T1-011 — K2 fiili ihlal / ihlale HAZIR küme sorgusu
-- "Tambur geri almasıyla iptal edilen kesim çocuğu 'İptali Geri Al' ile
--  diriltilebiliyor; metrajı ebeveyne ZATEN iade edilmişti → çift sayım."
--
-- Koşum: audit/tools/sql-saha.sh -f audit/data/BULGU-T1-011.sql   (prod kopyası)
--        audit/tools/sql-dev.sh  -f audit/data/BULGU-T1-011.sql   (dev)
-- SALT-OKUNUR. Kişisel veri yok (yalnız id/barkod/metraj).
-- =============================================================================

\echo '=== 0) TAMBUR_UNDO* audit olay sayısı (kaynak evren) ==='
SELECT count(*) AS undo_olay,
       count(*) FILTER (WHERE "newData" ? 'cancelledChildId') AS cocuk_iptal_eden
FROM system_logs
WHERE "newData"->>'event' LIKE 'TAMBUR_UNDO%';

\echo ''
\echo '=== 1) Undo ile iptal edilen çocuklar × restore yükleminin TAMAMI ==='
-- Yüklem birebir resolveRollRestoreBlockReason (roll-cancel-restore.helper.ts:70-110):
--   status=CANCELLED · movementCount=0 · operationCount=0 · childCount=0
--   · currentStepId IS NULL · sackId/shipmentId IS NULL
--   · dispatchItemCount=0 · kartelaItemCount=0
-- (batchId engeli 2026-08-25'te KALDIRILDI → yüklemde YOK.)
-- parentRollId yüklemde YOK → asıl bulgu bu.
WITH undo AS (
  SELECT DISTINCT ("newData"->>'cancelledChildId')::uuid AS child,
         "newData"->>'restoredTo'  AS restored_to,
         ("newData"->>'restoredLen')::numeric AS restored_len
  FROM system_logs
  WHERE "newData"->>'event' LIKE 'TAMBUR_UNDO%'
    AND "newData" ? 'cancelledChildId'
), c AS (
  SELECT r.id, r."parentRollId", r."currentQty", r."preCancelStatus", r."cancelledAt",
         (SELECT count(*) FROM roll_movements m WHERE m."rollId"=r.id) mv,
         (SELECT count(*) FROM roll_operations o WHERE o."rollId"=r.id) op,
         (SELECT count(*) FROM rolls k WHERE k."parentRollId"=r.id) ch,
         (SELECT count(*) FROM subcontractor_dispatch_items d WHERE d."rollId"=r.id) di,
         (SELECT count(*) FROM kartela_dispatch_items ki WHERE ki."rollId"=r.id) ki
  FROM rolls r
  WHERE r.status='CANCELLED' AND r."sackId" IS NULL AND r."shipmentId" IS NULL
    AND r."currentStepId" IS NULL
)
SELECT count(*)                                   AS diriltilebilir_undo_cocugu,
       sum(c."currentQty")                        AS toplam_metraj,
       count(*) FILTER (WHERE c."parentRollId" IS NOT NULL) AS parenti_olan,
       count(*) FILTER (WHERE c."preCancelStatus" IS NULL)  AS precancel_null,
       count(*) FILTER (WHERE c."cancelledAt" IS NULL)      AS cancelledat_null
FROM c JOIN undo u ON u.child = c.id
WHERE c.mv=0 AND c.op=0 AND c.ch=0 AND c.di=0 AND c.ki=0;

\echo ''
\echo '=== 2) Metraj GERÇEKTEN ebeveyne iade edilmiş miydi? (audit restoredTo) ==='
-- restoredTo = IN_PRODUCTION | WAREHOUSE  → metraj ebeveyne GERİ KONDU (çift sayım riski)
-- restoredTo = VARIANCE                   → metraj sapma defterine yazıldı (kaynak arşivde)
WITH undo AS (
  SELECT DISTINCT ("newData"->>'cancelledChildId')::uuid AS child,
         "newData"->>'restoredTo'  AS restored_to,
         ("newData"->>'restoredLen')::numeric AS restored_len
  FROM system_logs
  WHERE "newData"->>'event' LIKE 'TAMBUR_UNDO%' AND "newData" ? 'cancelledChildId'
), c AS (
  SELECT r.id, r."currentQty",
         (SELECT count(*) FROM roll_movements m WHERE m."rollId"=r.id) mv,
         (SELECT count(*) FROM roll_operations o WHERE o."rollId"=r.id) op,
         (SELECT count(*) FROM rolls k WHERE k."parentRollId"=r.id) ch,
         (SELECT count(*) FROM subcontractor_dispatch_items d WHERE d."rollId"=r.id) di,
         (SELECT count(*) FROM kartela_dispatch_items ki WHERE ki."rollId"=r.id) ki
  FROM rolls r
  WHERE r.status='CANCELLED' AND r."sackId" IS NULL AND r."shipmentId" IS NULL
    AND r."currentStepId" IS NULL
)
SELECT coalesce(u.restored_to,'(yok/FULL)') AS restored_to,
       count(*) AS top, sum(c."currentQty") AS metraj, sum(u.restored_len) AS iade_edilen
FROM c JOIN undo u ON u.child=c.id
WHERE c.mv=0 AND c.op=0 AND c.ch=0 AND c.di=0 AND c.ki=0
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 3) Örnek kayıtlar (ilk 10) — ebeveyn hâlâ canlı + metrajı iade almış ==='
WITH undo AS (
  SELECT DISTINCT ("newData"->>'cancelledChildId')::uuid AS child,
         "newData"->>'restoredTo' AS restored_to,
         ("newData"->>'restoredLen')::numeric AS restored_len
  FROM system_logs
  WHERE "newData"->>'event' LIKE 'TAMBUR_UNDO%' AND "newData" ? 'cancelledChildId'
)
SELECT left(c.id::text,8) AS cocuk_id, c.barcode AS cocuk_barkod,
       c."currentQty" AS cocuk_qty, c."preCancelStatus", c."cancelledAt" IS NULL AS iz_yok,
       u.restored_to, u.restored_len,
       left(p.id::text,8) AS ebeveyn_id, p.status AS ebeveyn_status,
       p."currentQty" AS ebeveyn_qty, p."initialQty" AS ebeveyn_initial
FROM rolls c
JOIN undo u ON u.child=c.id
LEFT JOIN rolls p ON p.id=c."parentRollId"
WHERE c.status='CANCELLED' AND c."sackId" IS NULL AND c."shipmentId" IS NULL
  AND c."currentStepId" IS NULL
  AND (SELECT count(*) FROM roll_movements m WHERE m."rollId"=c.id)=0
  AND (SELECT count(*) FROM roll_operations o WHERE o."rollId"=c.id)=0
  AND (SELECT count(*) FROM rolls k WHERE k."parentRollId"=c.id)=0
  AND (SELECT count(*) FROM subcontractor_dispatch_items d WHERE d."rollId"=c.id)=0
  AND (SELECT count(*) FROM kartela_dispatch_items ki WHERE ki."rollId"=c.id)=0
ORDER BY c."updatedAt" DESC
LIMIT 10;

\echo ''
\echo '=== 4) AUDIT LOGSUZ evren — parentRollId dolu + diriltilebilir TÜM iptaller ==='
-- system_logs 6 ayda arşivleniyor (CLAUDE.md) → audit'e bel bağlamayan üst sınır.
SELECT count(*) AS diriltilebilir_kesim_cocugu, sum(r."currentQty") AS metraj
FROM rolls r
WHERE r.status='CANCELLED' AND r."parentRollId" IS NOT NULL
  AND r."sackId" IS NULL AND r."shipmentId" IS NULL AND r."currentStepId" IS NULL
  AND (SELECT count(*) FROM roll_movements m WHERE m."rollId"=r.id)=0
  AND (SELECT count(*) FROM roll_operations o WHERE o."rollId"=r.id)=0
  AND (SELECT count(*) FROM rolls k WHERE k."parentRollId"=r.id)=0
  AND (SELECT count(*) FROM subcontractor_dispatch_items d WHERE d."rollId"=r.id)=0
  AND (SELECT count(*) FROM kartela_dispatch_items ki WHERE ki."rollId"=r.id)=0;

\echo ''
\echo '=== 5) KARŞILAŞTIRMA: TÜM diriltilebilir iptaller (parentsiz dahil) ==='
SELECT count(*) AS tum_diriltilebilir, sum(r."currentQty") AS metraj,
       count(*) FILTER (WHERE r."parentRollId" IS NOT NULL) AS bunun_kesim_cocugu
FROM rolls r
WHERE r.status='CANCELLED'
  AND r."sackId" IS NULL AND r."shipmentId" IS NULL AND r."currentStepId" IS NULL
  AND (SELECT count(*) FROM roll_movements m WHERE m."rollId"=r.id)=0
  AND (SELECT count(*) FROM roll_operations o WHERE o."rollId"=r.id)=0
  AND (SELECT count(*) FROM rolls k WHERE k."parentRollId"=r.id)=0
  AND (SELECT count(*) FROM subcontractor_dispatch_items d WHERE d."rollId"=r.id)=0
  AND (SELECT count(*) FROM kartela_dispatch_items ki WHERE ki."rollId"=r.id)=0;

\echo ''
\echo '=== 6) AUDIT-BAĞIMSIZ ÜST SINIR: "iz yok" imzası (cancelledAt+preCancelStatus NULL) ==='
-- softDelete iptali HER ZAMAN cancelledAt + preCancelStatus yazar
-- (inventory.service.softDelete). tambur-undo ailesinin ham `updateMany data:{status}`
-- yazımı YAZMAZ (tambur-undo.service.ts:1073-1080, 1260-1267, 1488-1495).
-- Dolayısıyla "CANCELLED + parentRollId dolu + izsiz" = undo imzası; system_logs
-- 6 ayda arşivlense de bu imza satırda kalır.
SELECT count(*) AS diriltilebilir_kesim_cocugu,
       sum(r."currentQty") AS metraj,
       count(*) FILTER (WHERE r."cancelledAt" IS NULL AND r."preCancelStatus" IS NULL) AS iz_yok_undo_imzasi,
       sum(r."currentQty") FILTER (WHERE r."cancelledAt" IS NULL AND r."preCancelStatus" IS NULL) AS iz_yok_metraj
FROM rolls r
WHERE r.status='CANCELLED' AND r."parentRollId" IS NOT NULL
  AND r."sackId" IS NULL AND r."shipmentId" IS NULL AND r."currentStepId" IS NULL
  AND (SELECT count(*) FROM roll_movements m WHERE m."rollId"=r.id)=0
  AND (SELECT count(*) FROM roll_operations o WHERE o."rollId"=r.id)=0
  AND (SELECT count(*) FROM rolls k WHERE k."parentRollId"=r.id)=0
  AND (SELECT count(*) FROM subcontractor_dispatch_items d WHERE d."rollId"=r.id)=0
  AND (SELECT count(*) FROM kartela_dispatch_items ki WHERE ki."rollId"=r.id)=0;
