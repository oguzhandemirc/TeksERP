-- V-5 TUR2 §4 — audit madenciliği: eşzamanlılık izleri
\echo '### A) Aynı kullanıcı+cihaz+tablo+action, 1 sn içinde tekrar (çift tıklama / retry izi)'
WITH s AS (
  SELECT id, "userId", "deviceId", "tableName", action, "recordId", "createdAt",
         LAG("createdAt") OVER (PARTITION BY "userId", COALESCE("deviceId",''), "tableName", action ORDER BY "createdAt") AS onceki
  FROM system_logs WHERE "userId" IS NOT NULL
)
SELECT "tableName", action, count(*) AS bir_sn_ici_tekrar,
       min(EXTRACT(epoch FROM ("createdAt"-onceki))) AS en_kisa_sn
FROM s WHERE onceki IS NOT NULL AND "createdAt" - onceki < interval '1 second'
GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20;

\echo '### B) Aynı KAYIT üzerinde 5 sn içinde İKİ FARKLI kullanıcı yazması (lost update izi)'
SELECT a."tableName", a."recordId", a.action AS a_act, b.action AS b_act,
       a."createdAt", EXTRACT(epoch FROM (b."createdAt"-a."createdAt")) AS sn
FROM system_logs a JOIN system_logs b
  ON a."tableName"=b."tableName" AND a."recordId"=b."recordId"
 AND a."userId" <> b."userId" AND b."createdAt" > a."createdAt"
 AND b."createdAt" < a."createdAt" + interval '5 seconds'
WHERE a."recordId" IS NOT NULL AND a."userId" IS NOT NULL AND b."userId" IS NOT NULL
ORDER BY sn LIMIT 20;

\echo '### C) Aynı SANİYEDE toplam yazma sayısı — en yoğun 15 saniye'
SELECT date_trunc('second',"createdAt") AS sn, count(*) AS yazma,
       count(DISTINCT "userId") AS kullanici, count(DISTINCT "deviceId") AS cihaz
FROM system_logs GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

\echo '### D) En yoğun DAKİKA'
SELECT date_trunc('minute',"createdAt") AS dk, count(*) AS yazma,
       count(DISTINCT "userId") AS kullanici, count(DISTINCT "deviceId") AS cihaz
FROM system_logs GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

\echo '### E) Saatlik yığılma (fabrika saati) — vardiya penceresi'
SELECT EXTRACT(hour FROM ("createdAt" AT TIME ZONE 'Europe/Istanbul'))::int AS saat,
       count(*) AS yazma, count(DISTINCT "deviceId") AS cihaz,
       round(count(*)::numeric/40,1) AS gun_basina
FROM system_logs GROUP BY 1 ORDER BY 1;
