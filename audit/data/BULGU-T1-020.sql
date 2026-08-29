-- =============================================================================
-- BULGU-T1-020 (K2) — kur.ps1 [5/9] ecosystem.config.js'i paketinkiyle EZER.
-- Ölçülecek: ÇALIŞAN prod process'inin yedek env'i, repo dosyasından AYRIŞMIŞ mı?
--   repo (Teks-Erp/ecosystem.config.js:107,124) → BACKUP_SCHEDULE_ENABLED="false"
--                                                 BACKUP_OFFSITE_DIR=""
-- SALT-OKUNUR. audit/tools/sql-saha.sh (prod kopyası) + sql-dev.sh
-- NOT: AuditService payload'ı newData'nın KÖKÜNDE durur (newData->>'trigger').
-- =============================================================================

\echo '=== §1 Yedek olayları: trigger + offsite uyarısı ==='
SELECT
  id,
  "createdAt" AT TIME ZONE 'Europe/Istanbul'                 AS ist,
  action,
  "newData"->>'trigger'                                      AS trigger,
  ("newData"->>'message') LIKE '%OFFSITE YEDEK AYARLANMADI%' AS offsite_kapali_uyarisi,
  left("newData"->>'message', 70)                            AS mesaj_bas
FROM system_logs
WHERE action IN ('BACKUP_COMPLETED','BACKUP_FAILED')
ORDER BY "createdAt" DESC
LIMIT 40;

\echo ''
\echo '=== §2 Ayrisma tablosu: trigger x offsite-uyarisi ==='
-- trigger='nightly'  → startBackupScheduler() ERKEN DONMEMIS
--                      => calisan process'te BACKUP_SCHEDULE_ENABLED <> "false"
-- offsite_kapali_uyarisi=false => calisan process'te BACKUP_OFFSITE_DIR DOLU
SELECT
  "newData"->>'trigger'                                      AS trigger,
  ("newData"->>'message') LIKE '%OFFSITE YEDEK AYARLANMADI%' AS offsite_kapali_uyarisi,
  count(*)                                                   AS adet,
  min("createdAt" AT TIME ZONE 'Europe/Istanbul')            AS ilk,
  max("createdAt" AT TIME ZONE 'Europe/Istanbul')            AS son
FROM system_logs
WHERE action = 'BACKUP_COMPLETED'
GROUP BY 1,2
ORDER BY 1,2;

\echo ''
\echo '=== §3 Backend zamanlayicisinin damgasi (TEK yazan: jobs/backup-scheduler.ts:32) ==='
SELECT key, value, "updatedAt" AT TIME ZONE 'Europe/Istanbul' AS ist
FROM system_settings
WHERE key IN ('backup.lastNightlyAt','backup.hour','backup.offsiteDir','backup.offsiteRemote')
ORDER BY key;

\echo ''
\echo '=== §4 Deploy zaman cizelgesi (kur.ps1 [7/9] prisma migrate deploy izi) ==='
SELECT date_trunc('minute', finished_at AT TIME ZONE 'Europe/Istanbul') AS deploy_ani,
       count(*) AS migration_adedi,
       max(migration_name) AS son_migration
FROM _prisma_migrations
WHERE finished_at > now() - interval '45 days'
GROUP BY 1 ORDER BY 1 DESC LIMIT 15;

\echo ''
\echo '=== §5 Birlesik kronoloji: deploy mu, yedek mi (ayrisma penceresi) ==='
(SELECT finished_at AT TIME ZONE 'Europe/Istanbul' AS ist, 'DEPLOY (migrate)'::text AS olay,
        migration_name AS detay
   FROM _prisma_migrations WHERE finished_at > now() - interval '20 days')
UNION ALL
(SELECT "createdAt" AT TIME ZONE 'Europe/Istanbul', 'YEDEK ' || action,
        coalesce("newData"->>'trigger','?') || ' | offsite_uyarisi=' ||
        (("newData"->>'message') LIKE '%OFFSITE YEDEK AYARLANMADI%')::text
   FROM system_logs
  WHERE action IN ('BACKUP_COMPLETED','BACKUP_FAILED')
    AND "createdAt" > now() - interval '20 days')
ORDER BY 1;

\echo ''
\echo '=== §6 Offsite supurucu (rclone) izleri ==='
SELECT action, count(*) AS adet, max("createdAt" AT TIME ZONE 'Europe/Istanbul') AS son
FROM system_logs
WHERE action ILIKE '%OFFSITE%' OR action ILIKE '%JOB_FAIL%'
GROUP BY action ORDER BY 2 DESC LIMIT 20;
