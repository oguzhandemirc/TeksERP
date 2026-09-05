-- =============================================================================
-- BULGU-T1-024 — K2 fiili ihlal sorguları
-- "Gece yedeğinin başarısız olduğunu gören hiçbir mekanizma yok; bayatlık
--  sayacı deploy yedeğiyle (premigrate_) sıfırlanıyor"
-- SALT-OKUNUR. Koşum:
--   audit/tools/sql-saha.sh -f audit/data/BULGU-T1-024.sql   (prod kopyası 2026-08-25)
--   audit/tools/sql-dev.sh  -f audit/data/BULGU-T1-024.sql   (dev)
-- =============================================================================

\echo '=== S0: log penceresi (gözlem aralığı) ==='
SELECT min("createdAt")::date AS ilk_log,
       max("createdAt")::date AS son_log,
       (max("createdAt")::date - min("createdAt")::date) AS gun_sayisi,
       count(*) AS toplam_log
FROM system_logs;

\echo '=== S1: yedek/iş defteri envanteri (action x trigger) ==='
SELECT action,
       coalesce("newData"->>'trigger', '-') AS trigger,
       count(*)                             AS adet,
       min("createdAt")::date               AS ilk,
       max("createdAt")::date               AS son
FROM system_logs
WHERE category = 'SYSTEM'
  AND (action LIKE 'BACKUP%' OR "recordId" LIKE 'JOB_FAILED%')
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '=== S2: BAŞARISIZLIK izi hiç var mı? (BACKUP_FAILED + JOB_FAILED) ==='
SELECT
  count(*) FILTER (WHERE action = 'BACKUP_FAILED')            AS backup_failed,
  count(*) FILTER (WHERE "recordId" LIKE 'JOB_FAILED:backup%') AS job_failed_backup,
  count(*) FILTER (WHERE "recordId" LIKE 'JOB_FAILED:%')       AS job_failed_tumu
FROM system_logs
WHERE category = 'SYSTEM';

\echo '=== S3: gece yedeğinin defterdeki günlük kapsaması ==='
-- "Kaç ayrı GÜN için backend defterinde bir gece yedeği kaydı var?"
WITH pencere AS (
  SELECT min("createdAt")::date AS ilk, max("createdAt")::date AS son FROM system_logs
)
SELECT p.ilk, p.son,
       (p.son - p.ilk + 1) AS penceredeki_gun,
       count(DISTINCT l."createdAt"::date) AS gece_yedegi_olan_gun
FROM pencere p
LEFT JOIN system_logs l
  ON l.category = 'SYSTEM'
 AND l.action   = 'BACKUP_COMPLETED'
 AND l."newData"->>'trigger' = 'nightly'
GROUP BY p.ilk, p.son;

\echo '=== S4: her BACKUP_COMPLETED satırı (dosya adı + tetikleyici) ==='
SELECT "createdAt",
       "newData"->>'trigger' AS trigger,
       "newData"->>'file'    AS dosya
FROM system_logs
WHERE category = 'SYSTEM' AND action IN ('BACKUP_COMPLETED', 'BACKUP_FAILED')
ORDER BY "createdAt";

\echo '=== S5: backend zamanlayıcısının damgası (backup.lastNightlyAt) ==='
-- createdAt = backend zamanlayıcısının İLK kez koştuğu an.
SELECT key, value::text AS deger, "createdAt", "updatedAt"
FROM system_settings
WHERE key LIKE 'backup%'
ORDER BY key;

\echo '=== S6: deploy günleri = bayatlık sayacının sıfırlandığı günler ==='
-- kur.ps1 [3/9] her kurulumda BACKUP_DIR içine premigrate_<damga>.dump yazar;
-- app.ts latestBackupInfo() türe bakmadığı için o dosya "son yedek" sayılır.
SELECT finished_at::date AS deploy_gunu, count(*) AS uygulanan_migration
FROM _prisma_migrations
WHERE finished_at > now() - interval '70 days'
GROUP BY 1
ORDER BY 1;
