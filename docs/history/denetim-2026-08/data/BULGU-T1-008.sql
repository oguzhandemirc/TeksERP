-- =============================================================================
-- BULGU-T1-008 — K2 fiili ihlal sorgusu
-- İddia: import.service.apply'da replay anahtarı (ImportRun satırı) EN SONDA
--        yazılıyor; koşum sürerken gelen ikinci istek token kapısını (findUnique)
--        boş bulur ve dosyayı BAŞTAN yazar.
-- Aranan fiili ihlal: (a) sahada özellik kullanılmış mı, (b) kullanıldıysa
--        aynı dosyanın iki kez yazıldığına dair iz, (c) 15 sn tavanının
--        aşılabildiğini gösteren süre ölçümü.
-- Koşum: audit/tools/sql-saha.sh -f audit/data/BULGU-T1-008.sql   (prod kopyası)
--        audit/tools/sql-dev.sh  -f audit/data/BULGU-T1-008.sql   (dev)
-- SALT-OKUNUR. Kişisel veri seçilmez (yalnız id/entity/sayı/süre).
-- =============================================================================

\echo '--- S1: import_runs tablosu var mı + toplam koşum ---'
SELECT to_regclass('public.import_runs') AS tablo,
       (SELECT count(*) FROM import_runs) AS kosum_sayisi;

\echo '--- S2: varlık başına koşum profili (satır sayısı / süre / ms-per-row) ---'
SELECT entity,
       count(*)                                                        AS kosum,
       max("rowCount")                                                 AS max_satir,
       max("durationMs")                                               AS max_sure_ms,
       round(avg("durationMs"::numeric / GREATEST("rowCount",1)), 2)   AS ort_ms_satir,
       max("durationMs"::numeric / GREATEST("rowCount",1))             AS max_ms_satir,
       -- 15 sn'lik istemci tavanı bu hızda kaç satırda aşılır?
       floor(15000 / NULLIF(max("durationMs"::numeric / GREATEST("rowCount",1)),0)) AS tavan_satir
FROM import_runs
GROUP BY entity
ORDER BY max_ms_satir DESC NULLS LAST;

\echo '--- S3: 15 sn tavanını FİİLEN aşmış koşum var mı (pencere açılmış demektir) ---'
SELECT id, entity, "rowCount", "durationMs", status, "createdAt"
FROM import_runs
WHERE "durationMs" >= 15000
ORDER BY "durationMs" DESC
LIMIT 20;

\echo '--- S4: clientToken TAŞIMAYAN koşumlar (kapı hiç devreye girmemiş) ---'
SELECT count(*) FILTER (WHERE "clientToken" IS NULL) AS tokensiz,
       count(*) FILTER (WHERE "clientToken" IS NOT NULL) AS tokenli,
       count(*) AS toplam
FROM import_runs;

\echo '--- S5: MÜKERRER YAZIM İZİ — aynı dosya adı + aynı varlık, 10 dk içinde 2+ koşum ---'
SELECT a.id AS kosum_1, b.id AS kosum_2, a.entity, a."fileName",
       a."rowCount" AS satir_1, b."rowCount" AS satir_2,
       a."createdAt" AS t1, b."createdAt" AS t2,
       round(EXTRACT(EPOCH FROM (b."createdAt" - a."createdAt"))::numeric,1) AS fark_sn
FROM import_runs a
JOIN import_runs b
  ON b.entity = a.entity
 AND b."fileName" IS NOT DISTINCT FROM a."fileName"
 AND b."rowCount" = a."rowCount"
 AND b."createdAt" > a."createdAt"
 AND b."createdAt" < a."createdAt" + interval '10 minutes'
ORDER BY a."createdAt" DESC
LIMIT 20;

\echo '--- S6: İÇE AKTARIMLA yazılmış kayıtlar (audit izi: newData._source = IMPORT) ---'
SELECT "tableName",
       count(*)                                                    AS audit_satiri,
       count(DISTINCT ("newData"->>'importRunId'))                  AS ayri_kosum
FROM system_logs
WHERE "newData" ? '_source' AND "newData"->>'_source' = 'IMPORT'
GROUP BY "tableName"
ORDER BY audit_satiri DESC;

\echo '--- S7: İÇE AKTARIMLA YAZILMIŞ MÜKERRER SİPARİŞ (fiili çift yazım) ---'
-- Aynı içe aktarım koşumunda değil, AYRI koşumlarda ama aynı müşteri+aynı toplam
-- metraj+aynı gün: create-only adaptörün ikinci turda ürettiği ikizin imzası.
WITH imp AS (
  SELECT DISTINCT ("recordId")::text AS order_id, ("newData"->>'importRunId') AS run_id
  FROM system_logs
  WHERE "tableName" = 'orders' AND "newData"->>'_source' = 'IMPORT'
)
SELECT o."customerId", date_trunc('day', o."createdAt") AS gun,
       count(*) AS siparis, count(DISTINCT i.run_id) AS ayri_kosum,
       array_agg(o.id ORDER BY o."createdAt") AS ornek_idler
FROM imp i JOIN orders o ON o.id::text = i.order_id
GROUP BY 1,2
HAVING count(*) > 1 AND count(DISTINCT i.run_id) > 1
ORDER BY siparis DESC
LIMIT 20;

\echo '--- S8: KORUMA TEYİDİ — import_runs üzerindeki kısıtlar/index (kilit yerine ne var) ---'
SELECT conname, contype, pg_get_constraintdef(oid) AS tanim
FROM pg_constraint WHERE conrelid = 'public.import_runs'::regclass
ORDER BY contype, conname;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'import_runs' ORDER BY indexname;

\echo '--- S9: KIYAS TABANI — orderService.create gerçek maliyeti (audit izinden sipariş yazma hızı) ---'
-- İçe aktarımın satır maliyeti = orderService.create; sahadaki en yoğun dakikada
-- kaç sipariş yazılabildiğine bakarak mertebe tahmini yapılır.
SELECT date_trunc('minute', "createdAt") AS dakika, count(*) AS siparis
FROM orders
GROUP BY 1 ORDER BY siparis DESC LIMIT 5;
