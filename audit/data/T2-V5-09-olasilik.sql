\echo '### 1) rolls: aynı SANİYEDE doğan top sayısı (offline kuyruk boşalması)'
SELECT n_ayni_saniye, count(*) AS saniye_sayisi FROM (
  SELECT date_trunc('second',"createdAt") s, count(*) n_ayni_saniye FROM rolls GROUP BY 1
) q GROUP BY 1 ORDER BY 1 DESC LIMIT 10;

\echo '### 2) rolls: ardışık iki top arasındaki en kısa süreler (ms)'
SELECT round(EXTRACT(epoch FROM fark)*1000)::int AS ms, count(*) FROM (
  SELECT "createdAt" - LAG("createdAt") OVER (ORDER BY "createdAt") AS fark FROM rolls
) q WHERE fark < interval '250 milliseconds' GROUP BY 1 ORDER BY 1 LIMIT 20;

\echo '### 3) İKİ FARKLI kullanıcı aynı saniyede top yazmış mı'
SELECT date_trunc('second',"createdAt") s, count(DISTINCT "createdById") kullanici, count(*) top
FROM rolls WHERE "createdById" IS NOT NULL GROUP BY 1 HAVING count(DISTINCT "createdById")>1 ORDER BY 2 DESC, 3 DESC LIMIT 10;

\echo '### 4) İKİ FARKLI MAKİNE aynı saniyede'
SELECT date_trunc('second',"createdAt") s, count(DISTINCT "createdMachineId") makine, count(*) top
FROM rolls WHERE "createdMachineId" IS NOT NULL GROUP BY 1 HAVING count(DISTINCT "createdMachineId")>1 ORDER BY 2 DESC LIMIT 10;

\echo '### 5) En yoğun DAKİKA (top doğuşu)'
SELECT date_trunc('minute',"createdAt") dk, count(*) top, count(DISTINCT "createdById") kullanici, count(DISTINCT "createdMachineId") makine
FROM rolls GROUP BY 1 ORDER BY 2 DESC LIMIT 8;

\echo '### 6) makineId / kullanıcı doluluk'
SELECT count(*) toplam, count("createdById") kullanici_dolu, count("createdMachineId") makine_dolu, count("entryStationId") istasyon_dolu FROM rolls;

\echo '### 7) Eşzamanlı OTURUM (work_sessions) — aynı anda kaç açık oturum'
SELECT count(*) FROM work_sessions;
