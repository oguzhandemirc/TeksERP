-- V-5 TUR2 §4 — Topun metrajı audit defterinden yeniden kurulabiliyor mu?
WITH cre AS (
  SELECT "recordId"::uuid rid,
         COALESCE(("newData"->>'lengthMeters')::numeric, ("newData"->>'cutLength')::numeric,
                  ("newData"->>'initialQty')::numeric, ("newData"->>'qtyIn')::numeric) AS log_metraj,
         "newData"->>'kind' kind
  FROM system_logs WHERE "tableName"='ROLL' AND action='CREATE' AND "recordId" IS NOT NULL
),
upd AS (
  SELECT "recordId"::uuid rid, count(*) n
  FROM system_logs WHERE "tableName"='ROLL' AND action='UPDATE' AND "recordId" IS NOT NULL GROUP BY 1
)
SELECT
  count(*) AS create_logu_olan_top,
  count(*) FILTER (WHERE c.log_metraj IS NULL) AS logda_metraj_YOK,
  count(*) FILTER (WHERE c.log_metraj IS NOT NULL AND c.log_metraj <> r."initialQty") AS LOG_ILE_SATIR_AYRISIK,
  count(*) FILTER (WHERE c.log_metraj IS NOT NULL AND c.log_metraj <> r."initialQty" AND COALESCE(u.n,0)=0) AS AYRISIK_VE_UPDATE_LOGU_YOK
FROM cre c JOIN rolls r ON r.id=c.rid LEFT JOIN upd u ON u.rid=c.rid;
