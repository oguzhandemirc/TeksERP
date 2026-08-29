-- =============================================================================
-- BULGU-T1-014 — K2 fiili maruziyet sorgusu
-- "6 haneli PIN tek başına kimliktir; tek savunma IP-anahtarlı bellek kilidi"
-- SALT-OKUNUR. Hiçbir PIN/parola/kart jetonu ÇIKTIYA BASILMAZ (yalnız sınıf sayıları).
-- Koşum: audit/tools/sql-saha.sh -f audit/data/BULGU-T1-014.sql
--        audit/tools/sql-dev.sh  -f audit/data/BULGU-T1-014.sql
-- =============================================================================
\pset pager off
\echo '### 1) Giriş yöntemi ayarı + PIN kilidi ayar satırları (yoksa KOD VARSAYILANI geçerli)'
SELECT key, value
FROM system_settings
WHERE key = 'auth.loginMethods'
   OR key LIKE 'auth.pinLockout%'
   OR key = 'auth.devicePairingRequired'
ORDER BY key;

\echo '### 2) PIN maruziyeti — kaç aktif kullanıcı tek-faktör PIN taşıyor'
SELECT count(*)                                              AS aktif_kullanici,
       count(*) FILTER (WHERE "quickPin" IS NOT NULL)        AS pinli,
       count(*) FILTER (WHERE "cardToken" IS NOT NULL)       AS kartli,
       count(DISTINCT "quickPin")                            AS farkli_pin
FROM users
WHERE "isActive" AND "deletedAt" IS NULL;

\echo '### 3) PIN taşıyan kullanıcılardan kaçı yönetici yetkisine sahip (admin:* / *:*)'
SELECT count(DISTINCT u.id) AS pinli_yonetici
FROM users u
JOIN user_permissions up ON up."userId" = u.id
JOIN permissions p       ON p.id = up."permissionId"
WHERE u."isActive" AND u."deletedAt" IS NULL AND u."quickPin" IS NOT NULL
  AND (p.code LIKE 'admin:%' OR p.code = '*:*' OR p.code = 'admin:*');

\echo '### 3b) PIN taşıyan yöneticilerin id ve yetki sayısı (kişisel veri/PIN YOK)'
SELECT u.id,
       count(*) FILTER (WHERE p.code LIKE 'admin:%') AS admin_yetki_sayisi,
       count(*)                                     AS toplam_yetki
FROM users u
JOIN user_permissions up ON up."userId" = u.id
JOIN permissions p       ON p.id = up."permissionId"
WHERE u."isActive" AND u."deletedAt" IS NULL AND u."quickPin" IS NOT NULL
GROUP BY u.id
HAVING count(*) FILTER (WHERE p.code LIKE 'admin:%') > 0
ORDER BY 2 DESC;

\echo '### 4) PIN entropi sınıfları — KAÇ TANE zayıf sınıfta (hangi sınıf/PIN BASILMAZ)'
WITH p AS (
  SELECT "quickPin" AS v FROM users
  WHERE "isActive" AND "deletedAt" IS NULL AND "quickPin" ~ '^[0-9]{6}$'
)
SELECT count(*)                                                              AS pin_sayisi,
       count(*) FILTER (WHERE v ~ '^(.)\1{5}$')                              AS ayni_rakam,
       count(*) FILTER (WHERE v ~ '^(..)\1{2}$')                             AS iki_hane_tekrar,
       count(*) FILTER (WHERE v ~ '^(...)\1$')                               AS uc_hane_tekrar,
       count(*) FILTER (WHERE v IN ('123456','654321','123123','111111','000000',
                                    '121212','112233','159753','101010','999999')) AS bilinen_zayif,
       count(*) FILTER (WHERE v ~ '^(19|20)[0-9]{2}[0-9]{2}$')               AS yil_benzeri,
       count(*) FILTER (WHERE left(v,1) = '0')                               AS sifirla_baslayan
FROM p;

\echo '### 4b) PIN sayısal dağılım — bitişik/ardışık atama var mı (değerler BASILMAZ)'
WITH p AS (
  SELECT ("quickPin")::bigint AS n FROM users
  WHERE "isActive" AND "deletedAt" IS NULL AND "quickPin" ~ '^[0-9]{6}$'
), d AS (
  SELECT n, n - lag(n) OVER (ORDER BY n) AS fark FROM p
)
SELECT count(*)                                   AS pin_sayisi,
       count(*) FILTER (WHERE fark IS NOT NULL AND fark <= 10)   AS komsu_fark_10_alti,
       count(*) FILTER (WHERE fark IS NOT NULL AND fark <= 1000) AS komsu_fark_1000_alti,
       count(DISTINCT (n / 100000))               AS farkli_ilk_hane_kovasi,
       round(100.0 * count(*) / 900000.0, 4)      AS kaba_isabet_yuzdesi_denemede
FROM d;

\echo '### 5) Fiili saldırı izi — son 90 günde başarısız/başarılı giriş, IP çeşitliliği'
SELECT action,
       count(*)                        AS adet,
       count(DISTINCT "ipAddress")     AS farkli_ip,
       min("createdAt")::date          AS ilk,
       max("createdAt")::date          AS son
FROM system_logs
WHERE action IN ('LOGIN_FAILED','LOGIN_SUCCESS','LOGIN_CONFLICT')
  AND "createdAt" > now() - interval '90 days'
GROUP BY action ORDER BY 1;

\echo '### 5b) Tek IP tek günde kaç başarısız deneme (kilit eşiğinin sahadaki izi)'
SELECT "ipAddress", "createdAt"::date AS gun, count(*) AS basarisiz
FROM system_logs
WHERE action = 'LOGIN_FAILED' AND "createdAt" > now() - interval '90 days'
GROUP BY 1,2 HAVING count(*) >= 5 ORDER BY 3 DESC LIMIT 10;

\echo '### 5c) LOGIN_FAILED payload: hangi giriş yöntemi'
SELECT COALESCE("recordId",'(yok)') AS yontem, count(*) AS adet
FROM system_logs
WHERE action = 'LOGIN_FAILED' AND "createdAt" > now() - interval '90 days'
GROUP BY 1 ORDER BY 2 DESC;

\echo '### 6) 429 LOGIN_LOCKED sahada hiç kuruldu mu (kilit gerçekten devrede mi izi)'
SELECT count(*) AS locked_kayit
FROM system_logs
WHERE ("newData"::text ILIKE '%LOGIN_LOCKED%' OR "newData"::text ILIKE '%429%')
  AND action IN ('LOGIN_FAILED','LOGIN_CONFLICT');
