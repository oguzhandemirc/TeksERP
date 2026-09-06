-- =============================================================================
-- BULGU-T1-001 — K2 fiili ihlal sorguları (SALT-OKUNUR)
-- "Düzelt" ekranının MUTLAK metraj yazımı (applyManualProperties) eşzamanlı /
-- sonraki Tambur depo kesimini eziyor; kesim initialQty'yi de düşürdüğü için
-- `rollWhole` guard'ı kesimden SONRA da TRUE kalıyor.
-- Koşum: audit/tools/sql-saha.sh -f audit/data/BULGU-T1-001.sql
--        audit/tools/sql-dev.sh  -f audit/data/BULGU-T1-001.sql
-- =============================================================================

\echo '=== Q1 · ROLL_MANUAL_OVERRIDE toplam log sayisi (yolun kullanim hacmi) ==='
SELECT count(*) AS toplam_override,
       count(*) FILTER (WHERE "newData"->>'currentQty' IS NOT NULL) AS metraj_yazan,
       count(*) FILTER (WHERE "newData"->>'event' = 'MANUAL_ATTRIBUTE') AS supervizor_duzeltme,
       min("createdAt")::date AS ilk, max("createdAt")::date AS son
FROM system_logs WHERE "tableName" = 'ROLL_MANUAL_OVERRIDE';

\echo ''
\echo '=== Q2 · Metrajı FİİLEN degistiren override satirlari (eski<>yeni) ==='
SELECT id, "recordId" AS roll_id,
       "oldData"->>'currentQty' AS eski_qty,
       "newData"->>'currentQty' AS yeni_qty,
       "newData"->>'event' AS olay,
       "createdAt"
FROM system_logs
WHERE "tableName" = 'ROLL_MANUAL_OVERRIDE'
  AND "newData"->>'currentQty' IS NOT NULL
  AND ("newData"->>'currentQty')::numeric IS DISTINCT FROM ("oldData"->>'currentQty')::numeric
ORDER BY "createdAt" DESC LIMIT 20;

\echo ''
\echo '=== Q3 · ÇAKISMA: kesilmis (cocuklu) topa kesimden SONRA metraj yazilmis mi? ==='
-- Guard'in olu oldugu pencere: parent kesildikten sonra `rollWhole` yine TRUE
-- oldugu icin metraj duzeltmesi kabul edilir; bayat payload kesimin aritmetigini siler.
WITH ilk_cocuk AS (
  SELECT "parentRollId" AS parent_id, min("createdAt") AS ilk_kesim
  FROM rolls WHERE "parentRollId" IS NOT NULL GROUP BY "parentRollId"
)
SELECT l.id AS log_id, l."recordId" AS parent_roll_id, k.ilk_kesim, l."createdAt" AS override_ts,
       l."oldData"->>'currentQty' AS log_eski_qty, l."newData"->>'currentQty' AS log_yeni_qty
FROM system_logs l
JOIN ilk_cocuk k ON k.parent_id::text = l."recordId"
WHERE l."tableName" = 'ROLL_MANUAL_OVERRIDE'
  AND l."newData"->>'currentQty' IS NOT NULL
  AND l."createdAt" > k.ilk_kesim
ORDER BY l."createdAt" DESC LIMIT 20;

\echo ''
\echo '=== Q3b · Ayni cakismanin sayisi (0 ise: mekanizma canlida henuz tetiklenmemis) ==='
WITH ilk_cocuk AS (
  SELECT "parentRollId" AS parent_id, min("createdAt") AS ilk_kesim
  FROM rolls WHERE "parentRollId" IS NOT NULL GROUP BY "parentRollId"
)
SELECT count(*) AS cakisma_sayisi
FROM system_logs l JOIN ilk_cocuk k ON k.parent_id::text = l."recordId"
WHERE l."tableName" = 'ROLL_MANUAL_OVERRIDE'
  AND l."newData"->>'currentQty' IS NOT NULL AND l."createdAt" > k.ilk_kesim;

\echo ''
\echo '=== Q4 · MARUZ KALAN NUFUS: "Duzelt" kapsamindaki (FREE_STOCK) kesilmis toplar ==='
-- FREE_STOCK = STOCK/WAREHOUSE/A1_STOCK → sebep opsiyonel + ek yetki YOK.
SELECT p.status, count(*) AS kesilmis_parent, sum(c.cocuk) AS cocuk_toplam
FROM rolls p
JOIN (SELECT "parentRollId" pid, count(*) cocuk FROM rolls WHERE "parentRollId" IS NOT NULL GROUP BY 1) c
  ON c.pid = p.id
WHERE p.status IN ('STOCK','WAREHOUSE','A1_STOCK')
GROUP BY p.status ORDER BY 2 DESC;

\echo ''
\echo '=== Q5 · consistency-check §13 (currentQty > initialQty) — BU HATAYI GORMEZ ==='
-- Kesim ikisini birden dusurdugu, duzeltme de ikisini birden yazdigi icin
-- currentQty == initialQty her zaman korunur → §13 kirmizi VERMEZ (kor nokta).
SELECT count(*) AS s13_ihlal FROM rolls WHERE "currentQty" > "initialQty";

\echo ''
\echo '=== Q5b · §13 ihlallerinin cocuklu (kesilmis) olanlari — kaynak ayrimi ==='
SELECT r.id, r.barcode, r.status, r."initialQty", r."currentQty",
       (SELECT count(*) FROM rolls c WHERE c."parentRollId" = r.id) AS cocuk_sayisi
FROM rolls r WHERE r."currentQty" > r."initialQty" ORDER BY r."updatedAt" DESC LIMIT 10;

\echo ''
\echo '=== Q6 · Kesilmis toplarda cur=init esitligi (hatanin gorunmezliginin olcumu) ==='
SELECT count(*) AS kesilmis_parent,
       count(*) FILTER (WHERE p."currentQty" = p."initialQty") AS cur_esit_init,
       round(100.0 * count(*) FILTER (WHERE p."currentQty" = p."initialQty") / NULLIF(count(*),0), 1) AS yuzde
FROM rolls p WHERE EXISTS (SELECT 1 FROM rolls c WHERE c."parentRollId" = p.id);
