// dump-aktar — SQL gövdeleri. Tablo/anahtar adları yalnız sınıflar modülünden gelir (kullanıcı girdisi değil);
// yine de her ad `lit`/`id` ile kaçışlanır. Birleştirme TEK tx'tedir: yarıda kalırsa HEDEF dokunulmamış kalır.
import { AUDIT_KIMLIK_ETIKETLERI, IS_TABLOLARI, OZEL_TABLOLAR, SINIF } from "./dump-aktar-siniflar.mjs";

export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
export const id = (s) => `"${String(s).replace(/"/g, '""')}"`;

export const tablolarOf = (sinif) => Object.entries(OZEL_TABLOLAR).filter(([, [s]]) => s === sinif).map(([t]) => t);
/** DENEME'den HEDEF'in hazırlık şemasına kopyalanan tablolar. */
export const SAHNELENEN = [...tablolarOf(SINIF.KIMLIK), ...tablolarOf(SINIF.BIRLESIM), "system_settings", "system_logs", "sync_watermarks"];

/** users şemasının bugünkü kolon kümesi — değişirse KAYNAK kullanıcı süpürmesi yeni sır kolonunu kaçırabilir ⇒ DUR. */
export const USERS_KOLONLARI = [
  "username", "passwordHash", "fullName", "isActive", "createdAt", "updatedAt", "id", "tokenVersion", "cardToken",
  "quickPin", "deletedAt", "createdById", "updatedById", "totpEnabledAt", "totpLastStep", "totpSecret", "isSystemAccount",
  "quickPinDigest", "quickPinSetAt", "cardTokenDigest", "cardIssuedAt", "cardTokenLegacy", "mustChangePassword",
  "defaultPasswordIssuedAt", "defaultPasswordChangedAt", "systemAccountSeal",
];
/** KAYNAK kullanıcı adlarına eklenen önek (DENEME adlarıyla çakışmasın; giriş zaten kapalı). */
export const KULLANICI_ONEKI = "as.";

/** HEDEF'te kontrol şeması + yardımcılar + başlangıç sayımı + KAYNAK kimlik iğneleri. */
export function hazirlaSql({ kurulumDesenleri }) {
  const sinifSatirlari = [
    ...IS_TABLOLARI.map((t) => [t, SINIF.IS]),
    ...Object.entries(OZEL_TABLOLAR).map(([t, [s]]) => [t, s]),
  ];
  return `
CREATE SCHEMA aktar_kontrol;
CREATE SCHEMA aktar_deneme;
CREATE TABLE aktar_kontrol.siniflar (tablo text PRIMARY KEY, sinif text NOT NULL);
INSERT INTO aktar_kontrol.siniflar VALUES ${sinifSatirlari.map(([t, s]) => `(${lit(t)}, ${lit(s)})`).join(", ")};
CREATE TABLE aktar_kontrol.kurulum_ayar (desen text NOT NULL);
INSERT INTO aktar_kontrol.kurulum_ayar VALUES ${kurulumDesenleri.map((d) => `(${lit(d)})`).join(", ")};
CREATE TABLE aktar_kontrol.audit_kimlik (etiket text PRIMARY KEY);
INSERT INTO aktar_kontrol.audit_kimlik VALUES ${AUDIT_KIMLIK_ETIKETLERI.map((e) => `(${lit(e)})`).join(", ")};
CREATE TABLE aktar_kontrol.sonuc (sira serial, durum text NOT NULL, ad text NOT NULL, detay text);

CREATE FUNCTION aktar_kontrol.kolonlar(t text, onek text DEFAULT '') RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT string_agg(onek || quote_ident(attname), ', ' ORDER BY attnum) FROM pg_attribute
   WHERE attrelid = ('public.' || quote_ident(t))::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
$f$;
CREATE FUNCTION aktar_kontrol.say(sema text, t text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE n bigint; BEGIN EXECUTE format('SELECT count(*) FROM %I.%I', sema, t) INTO n; RETURN n; END $f$;
CREATE FUNCTION aktar_kontrol.kurulum_anahtari(k text) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT EXISTS (SELECT 1 FROM aktar_kontrol.kurulum_ayar WHERE k LIKE desen)
$f$;
CREATE FUNCTION aktar_kontrol.yaz(durum text, ad text, detay text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO aktar_kontrol.sonuc (durum, ad, detay) VALUES (durum, ad, detay)
$f$;

CREATE TABLE aktar_kontrol.sayim_once AS
  SELECT tablename::text AS tablo, aktar_kontrol.say('public', tablename) AS n FROM pg_tables WHERE schemaname = 'public';

-- KAYNAK'ın kurulum kimliği ve uzak yedek hedefi: birleşmeden SONRA HEDEF'in hiçbir metin kolonunda geçmemeli.
CREATE TABLE aktar_kontrol.igne (ad text, deger text);
INSERT INTO aktar_kontrol.igne
  SELECT 'kaynak-kurulum-kimligi', m[1] FROM public.system_settings s,
         regexp_matches(s.value::text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'gi') m
   WHERE s.key = 'system.installationId';
INSERT INTO aktar_kontrol.igne
  SELECT 'kaynak-uzak-yedek', trim(both '"' from s.value::text) FROM public.system_settings s
   WHERE s.key LIKE 'backup.%' AND length(trim(both '"' from s.value::text)) >= 8 AND s.value::text NOT IN ('true', 'false');
`;
}

/** Hazırlık şemasında boş tablo (yalnız üretilmemiş kolonlar, kısıtsız). */
export const sahneTablosuSql = (t) =>
  `DO $d$ BEGIN EXECUTE format('CREATE TABLE aktar_deneme.%I AS SELECT %s FROM public.%I WITH NO DATA', ${lit(t)}, aktar_kontrol.kolonlar(${lit(t)}), ${lit(t)}); END $d$;
SELECT aktar_kontrol.kolonlar(${lit(t)});`;

/** TEK tx — FK/trigger kapalı (replica): defter trigger'ları (rolls → roll_status_events, audit zinciri, sync_marks) TETİKLENMEZ. */
export function birlestirSql() {
  const kimlik = tablolarOf(SINIF.KIMLIK);
  const kopyala = (t, where = "") =>
    `EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM aktar_deneme.%I ${where.replace(/'/g, "''")}', ${lit(t)}, aktar_kontrol.kolonlar(${lit(t)}), aktar_kontrol.kolonlar(${lit(t)}), ${lit(t)});`;
  return `
BEGIN;
SET LOCAL session_replication_role = replica;
DO $b$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM aktar_deneme.system_settings WHERE key = 'system.installationId') THEN
    RAISE EXCEPTION 'DENEME kurulum kimliği (system.installationId) hazırlık şemasında yok — DUR';
  END IF;

  -- ① KİMLİK tabloları: KAYNAK satırları atılır, DENEME satırları aynen.
${kimlik.map((t) => `  DELETE FROM public.${id(t)};\n  ${kopyala(t)}`).join("\n")}

  -- ② KAYNAK kullanıcıları: FK hedefi olarak KALIR — girişsiz, sırsız, pasif, sistem hesabı değil, adı önekli.
  UPDATE public.users SET
    username = left(${lit(KULLANICI_ONEKI)} || username, 50),
    "passwordHash" = '!aktarim-girissiz', "isActive" = false, "tokenVersion" = "tokenVersion" + 1,
    "cardToken" = NULL, "cardTokenDigest" = NULL, "cardIssuedAt" = NULL,
    "quickPin" = NULL, "quickPinDigest" = NULL, "quickPinSetAt" = NULL,
    "totpSecret" = NULL, "totpEnabledAt" = NULL, "totpLastStep" = NULL,
    "isSystemAccount" = false, "systemAccountSeal" = NULL,
    "defaultPasswordIssuedAt" = NULL, "defaultPasswordChangedAt" = NULL, "mustChangePassword" = true
  WHERE id NOT IN (SELECT id FROM aktar_deneme.users);
  ${kopyala("users")}

  -- ③ KAYNAK cihazları: work_sessions bağı için KALIR — pasif, onaysız, kanıt tuzu silinmiş.
  UPDATE public.devices SET "isActive" = false, status = 'PENDING', "proofSalt" = NULL, "proofIssuedAt" = NULL, "proofConfirmedAt" = NULL
  WHERE id NOT IN (SELECT id FROM aktar_deneme.devices);
  ${kopyala("devices")}

  -- ④ Ayarlar: kurulum-özel anahtarlar DENEME'den, iş ayarları KAYNAK'tan.
  DELETE FROM public.system_settings WHERE aktar_kontrol.kurulum_anahtari(key);
  ${kopyala("system_settings", "WHERE aktar_kontrol.kurulum_anahtari(key)")}

  -- ⑤ Audit: KAYNAK'tan yalnız zincir-öncesi İŞ ayak izi; DENEME zinciri aynen (sıra + özet korunur).
  DELETE FROM public.system_logs WHERE NOT (
    "chainSeq" IS NULL AND category::text IN ('DOMAIN', 'SYSTEM') AND action NOT LIKE 'AUDIT_CHAIN%'
    AND coalesce("tableName", '') NOT IN (SELECT etiket FROM aktar_kontrol.audit_kimlik));
  ${kopyala("system_logs")}

  -- ⑥ Eşitleme konumu sıfır (yalnız tur sayacı) ⇒ ilk tur TAM; silme işaretleri boş.
  DELETE FROM public.sync_watermarks;
  ${kopyala("sync_watermarks", "WHERE source = 'tur'")}
  DELETE FROM public.sync_marks;
END $b$;
COMMIT;
`;
}

/** Doğrulama — her bulgu aktar_kontrol.sonuc'a; HATA satırı varsa betik 1 ile çıkar. Değer basmaz, yalnız sayı/ad. */
export function dogrulaSql() {
  return `
DO $v$
DECLARE r record; n bigint; m bigint; k text; q text;
BEGIN
  -- ① İş tabloları satır satır KAYNAK'la eşit (HEDEF KAYNAK'tan klonlandı; birleşme dokunmamalı).
  FOR r IN SELECT s.tablo, o.n FROM aktar_kontrol.siniflar s JOIN aktar_kontrol.sayim_once o USING (tablo) WHERE s.sinif = 'IS' LOOP
    n := aktar_kontrol.say('public', r.tablo);
    IF n <> r.n THEN PERFORM aktar_kontrol.yaz('HATA', 'is-sayim', format('%s: önce %s sonra %s', r.tablo, r.n, n)); END IF;
  END LOOP;
  PERFORM aktar_kontrol.yaz('OK', 'is-sayim', (SELECT format('%s iş tablosu, %s satır', count(*), sum(o.n)) FROM aktar_kontrol.siniflar s JOIN aktar_kontrol.sayim_once o USING (tablo) WHERE s.sinif = 'IS'));

  -- ② KİMLİK tabloları DENEME ile küme-eşit (iki yönlü EXCEPT).
  FOR r IN SELECT tablo FROM aktar_kontrol.siniflar WHERE sinif = 'KIMLIK' LOOP
    k := aktar_kontrol.kolonlar(r.tablo);
    EXECUTE format('SELECT (SELECT count(*) FROM (SELECT %s FROM public.%I EXCEPT ALL SELECT %s FROM aktar_deneme.%I) a), (SELECT count(*) FROM (SELECT %s FROM aktar_deneme.%I EXCEPT ALL SELECT %s FROM public.%I) b)', k, r.tablo, k, r.tablo, k, r.tablo, k, r.tablo) INTO n, m;
    IF n + m > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'kimlik-esit', format('%s: fazla %s eksik %s', r.tablo, n, m)); END IF;
  END LOOP;
  PERFORM aktar_kontrol.yaz('OK', 'kimlik-esit', (SELECT format('%s kimlik tablosu denetlendi', count(*)) FROM aktar_kontrol.siniflar WHERE sinif = 'KIMLIK'));

  -- ③ Kullanıcılar: DENEME'ninkiler bayt-eşit (parola özeti · TOTP · PIN dahil); KAYNAK'ınkiler girişsiz.
  k := aktar_kontrol.kolonlar('users');
  EXECUTE format('SELECT count(*) FROM (SELECT %s FROM aktar_deneme.users EXCEPT ALL SELECT %s FROM public.users) x', k, k) INTO n;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'deneme-kullanici', format('%s DENEME kullanıcısı birebir değil', n)); END IF;
  SELECT count(*) INTO n FROM public.users WHERE id NOT IN (SELECT id FROM aktar_deneme.users) AND ("isActive" OR "isSystemAccount"
    OR "quickPin" IS NOT NULL OR "quickPinDigest" IS NOT NULL OR "cardToken" IS NOT NULL OR "cardTokenDigest" IS NOT NULL
    OR "totpSecret" IS NOT NULL OR "systemAccountSeal" IS NOT NULL OR "passwordHash" <> '!aktarim-girissiz');
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'kaynak-kullanici', format('%s KAYNAK kullanıcısı girişli/sırlı', n)); END IF;
  SELECT count(*) INTO n FROM (SELECT id FROM public.users WHERE "isSystemAccount" EXCEPT SELECT id FROM aktar_deneme.users WHERE "isSystemAccount") x;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'sistem-hesabi', 'DENEME dışı sistem hesabı var'); END IF;
  PERFORM aktar_kontrol.yaz('OK', 'kullanici', (SELECT format('DENEME %s (aktif %s, TOTP %s) · KAYNAK arşiv %s (aktif 0)',
    count(*) FILTER (WHERE id IN (SELECT id FROM aktar_deneme.users)),
    count(*) FILTER (WHERE id IN (SELECT id FROM aktar_deneme.users) AND "isActive"),
    count(*) FILTER (WHERE id IN (SELECT id FROM aktar_deneme.users) AND "totpEnabledAt" IS NOT NULL),
    count(*) FILTER (WHERE id NOT IN (SELECT id FROM aktar_deneme.users))) FROM public.users));
  SELECT count(*) INTO n FROM (SELECT attname::text FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped
    EXCEPT SELECT unnest(ARRAY[${USERS_KOLONLARI.map(lit).join(", ")}])) x;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'users-sema', format('%s yeni users kolonu — KAYNAK süpürmesini gözden geçir', n)); END IF;

  -- ④ Cihazlar.
  k := aktar_kontrol.kolonlar('devices');
  EXECUTE format('SELECT count(*) FROM (SELECT %s FROM aktar_deneme.devices EXCEPT ALL SELECT %s FROM public.devices) x', k, k) INTO n;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'deneme-cihaz', format('%s DENEME cihazı birebir değil', n)); END IF;
  SELECT count(*) INTO n FROM public.devices WHERE id NOT IN (SELECT id FROM aktar_deneme.devices) AND ("isActive" OR status <> 'PENDING' OR "proofSalt" IS NOT NULL);
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'kaynak-cihaz', format('%s KAYNAK cihazı etkin', n)); END IF;

  -- ⑤ Ayarlar: kurulum-özel küme DENEME'ninkiyle eşit; kurulum kimliği DENEME'nin.
  SELECT count(*) INTO n FROM (
    (SELECT key, value FROM public.system_settings WHERE aktar_kontrol.kurulum_anahtari(key)
     EXCEPT SELECT key, value FROM aktar_deneme.system_settings WHERE aktar_kontrol.kurulum_anahtari(key))
    UNION ALL
    (SELECT key, value FROM aktar_deneme.system_settings WHERE aktar_kontrol.kurulum_anahtari(key)
     EXCEPT SELECT key, value FROM public.system_settings WHERE aktar_kontrol.kurulum_anahtari(key))) x;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'kurulum-ayar', format('%s kurulum-özel ayar DENEME ile eşit değil', n)); END IF;
  IF (SELECT value FROM public.system_settings WHERE key = 'system.installationId')
     IS DISTINCT FROM (SELECT value FROM aktar_deneme.system_settings WHERE key = 'system.installationId') THEN
    PERFORM aktar_kontrol.yaz('HATA', 'kurulum-kimligi', 'system.installationId DENEME''ninki değil');
  ELSE PERFORM aktar_kontrol.yaz('OK', 'kurulum-kimligi', 'system.installationId = DENEME'); END IF;

  -- ⑥ KAYNAK kimlik iğneleri HEDEF'in HİÇBİR metin/json kolonunda yok.
  SELECT count(*) INTO m FROM aktar_kontrol.igne;
  IF m = 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'igne', 'KAYNAK kurulum kimliği okunamadı — arama yapılamaz'); END IF;
  FOR r IN SELECT c.table_name, c.column_name FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying', 'jsonb', 'json', 'character') LOOP
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE EXISTS (SELECT 1 FROM aktar_kontrol.igne i WHERE t.%I::text ILIKE ''%%'' || i.deger || ''%%'')', r.table_name, r.column_name) INTO n;
    IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'igne', format('%s.%s: %s satır KAYNAK kimliği/uzak yedek taşıyor', r.table_name, r.column_name, n)); END IF;
  END LOOP;
  PERFORM aktar_kontrol.yaz('OK', 'igne', format('%s iğne aranıyor', m));

  -- ⑦ FK bütünlüğü (replica kipinde FK denetlenmedi ⇒ her FK elle).
  m := 0;
  FOR r IN SELECT con.conname, con.conrelid::regclass AS cocuk, con.confrelid::regclass AS ebeveyn,
                  (SELECT string_agg(format('c.%I', a.attname), ',' ORDER BY u.i) FROM unnest(con.conkey) WITH ORDINALITY u(k, i) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.k) AS ck,
                  (SELECT string_agg(format('p.%I', a.attname), ',' ORDER BY u.i) FROM unnest(con.confkey) WITH ORDINALITY u(k, i) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.k) AS pk,
                  (SELECT string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ') FROM unnest(con.conkey) u(k) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.k) AS dolu
             FROM pg_constraint con WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace LOOP
    EXECUTE format('SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE (%s) = (%s))', r.cocuk, r.dolu, r.ebeveyn, r.pk, r.ck) INTO n;
    m := m + 1;
    IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'fk', format('%s (%s → %s): %s yetim', r.conname, r.cocuk, r.ebeveyn, n)); END IF;
  END LOOP;
  PERFORM aktar_kontrol.yaz('OK', 'fk', format('%s FK denetlendi', m));

  -- ⑧ Audit zinciri: DENEME zinciri aynen; zincir başından sonra zincirsiz satır yok (doğrulayıcının ZINCIRSIZ_SATIR'ı).
  k := aktar_kontrol.kolonlar('system_logs');
  EXECUTE format('SELECT count(*) FROM (SELECT %s FROM aktar_deneme.system_logs EXCEPT ALL SELECT %s FROM public.system_logs) x', k, k) INTO n;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'audit-zincir', format('%s DENEME audit satırı birebir değil', n)); END IF;
  SELECT count(*) INTO n FROM public.system_logs l WHERE l."chainSeq" IS NULL
     AND l."createdAt" > (SELECT min("createdAt") FROM public.system_logs WHERE "chainSeq" IS NOT NULL);
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'audit-zincirsiz', format('%s zincirsiz satır zincir başından yeni', n)); END IF;
  PERFORM aktar_kontrol.yaz('OK', 'audit', (SELECT format('zincirli %s · KAYNAK iş ayak izi %s (önce %s)',
    count(*) FILTER (WHERE "chainSeq" IS NOT NULL), count(*) FILTER (WHERE "chainSeq" IS NULL),
    (SELECT o.n FROM aktar_kontrol.sayim_once o WHERE o.tablo = 'system_logs')) FROM public.system_logs));

  -- ⑨ Eşitleme konumu yalnız tur sayacı; silme işareti yok.
  SELECT count(*) INTO n FROM public.sync_watermarks WHERE source <> 'tur';
  SELECT count(*) INTO m FROM public.sync_marks;
  IF n + m > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'esitleme', format('filigran %s · işaret %s', n, m));
  ELSE PERFORM aktar_kontrol.yaz('OK', 'esitleme', 'filigran sıfır (ilk tur TAM)'); END IF;
END $v$;
SELECT durum || '|' || ad || '|' || coalesce(detay, '') FROM aktar_kontrol.sonuc ORDER BY sira;
`;
}
