\echo '### Geri alma / iptal / storno sıklığı (prod-gerçek pencere: <= 2026-08-25 02:38)'
SELECT "newData"->>'event' AS olay, count(*) FROM system_logs
WHERE "createdAt" < '2026-08-25 02:38' AND "newData"->>'event' IN
 ('TAMBUR_UNDO_SINGLE','TAMBUR_UNDO_FULL','TAMBUR_UNDO_RESTORE','CANCEL_RESTORED','WO_CLOSE_DISPOSITION','MANUAL_MOVE','RELABEL','MASTER_DATA_MERGE','LABEL_OVERRIDE_EDIT','TARGET_COLOR_CHANGED','TARGET_WIDTH_CHANGED')
GROUP BY 1 ORDER BY 2 DESC;

\echo '### Roll statü dağılımı — iptal/fire oranı'
SELECT status, count(*), round(100.0*count(*)/sum(count(*)) OVER (),2) AS yuzde FROM rolls GROUP BY 1 ORDER BY 2 DESC;

\echo '### WO_CLOSE_DISPOSITION dağılımı (movement notes)'
SELECT notes, count(*) FROM roll_movements WHERE notes LIKE 'WO_CLOSE_%' GROUP BY 1 ORDER BY 2 DESC;

\echo '### RollVariance (sapma defteri) dağılımı'
SELECT kind, "reasonCode", count(*), sum(qty) FROM roll_variances GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15;

\echo '### RollPlanDeviation (plan sapma) dağılımı'
SELECT source, field, count(*) FROM roll_plan_deviations GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15;

\echo '### Sevkiyat storno / iade'
SELECT (SELECT count(*) FROM shipments) shipments,
       (SELECT count(*) FROM shipments WHERE status='PLANNED') planned,
       (SELECT count(*) FROM roll_returns) iade,
       (SELECT count(*) FROM printed_documents WHERE status='VOIDED') void_belge;
