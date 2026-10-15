// dump-aktar — SQL gövdeleri. Tablo/anahtar adları yalnız sınıflar modülünden gelir (kullanıcı girdisi değil);
// yine de her ad `lit`/`id` ile kaçışlanır. Birleştirme TEK tx'tedir: yarıda kalırsa HEDEF dokunulmamış kalır.
import { IS_TABLOLARI, OZEL_TABLOLAR, SINIF } from "./dump-aktar-siniflar.mjs";

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
/** KAYNAK cihaz adlarına eklenen önek — zaten bununla başlayan ada tekrar eklenmez. */
export const CIHAZ_ONEKI = "as. ";
/** Açılan modül satırının açıklaması (değer basılmaz; yalnız iz). */
export const MODUL_ACIKLAMA = "dump-aktar: deneme kurulumunda tüm modüller açık";

/** HEDEF'te kontrol şeması + yardımcılar + başlangıç sayımı + KAYNAK kimlik iğneleri. */
export function hazirlaSql({ kurulumDesenleri, bayrak }) {
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
-- Modül/bayrak/özellik ayarları (koddan türetilir) — DENEME'den; modül satırları ayrıca AÇIK'a çekilir.
CREATE TABLE aktar_kontrol.bayrak_ayar (key text PRIMARY KEY, modul boolean NOT NULL);
INSERT INTO aktar_kontrol.bayrak_ayar VALUES ${bayrak.bayrak.map((k) => `(${lit(k)}, ${bayrak.modul.includes(k)})`).join(", ")};
CREATE TABLE aktar_kontrol.modul_bagimlilik (bagimli text NOT NULL, on_kosul text NOT NULL);
INSERT INTO aktar_kontrol.modul_bagimlilik VALUES ${bayrak.bagimlilik.map(([b, o]) => `(${lit(b)}, ${lit(o)})`).join(", ")};
CREATE TABLE aktar_kontrol.acilan_modul (key text PRIMARY KEY, deneme_satiri_var boolean NOT NULL);
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
-- DENEME'den gelen anahtar: kurulum-özel ∪ modül/bayrak/özellik.
CREATE FUNCTION aktar_kontrol.deneme_anahtari(k text) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT aktar_kontrol.kurulum_anahtari(k) OR EXISTS (SELECT 1 FROM aktar_kontrol.bayrak_ayar WHERE key = k)
$f$;
-- asBoolean ikizi (system-setting.service.ts): boolean true ya da "true" dizesi açık; başka her şey kapalı.
CREATE FUNCTION aktar_kontrol.acik_mi(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT coalesce(v = 'true'::jsonb OR v = '"true"'::jsonb, false)
$f$;
CREATE FUNCTION aktar_kontrol.yaz(durum text, ad text, detay text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO aktar_kontrol.sonuc (durum, ad, detay) VALUES (durum, ad, detay)
$f$;

CREATE TABLE aktar_kontrol.sayim_once AS
  SELECT tablename::text AS tablo, aktar_kontrol.say('public', tablename) AS n FROM pg_tables WHERE schemaname = 'public';
-- KAYNAK'ın ayarları ve cihaz adları birleşmeden ÖNCE (doğrulama ve sondalar kıyaslar).
CREATE TABLE aktar_kontrol.ayar_once AS SELECT key, value FROM public.system_settings;
CREATE TABLE aktar_kontrol.cihaz_once AS SELECT id, name FROM public.devices;

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

  -- ③ KAYNAK cihazları: work_sessions bağı için KALIR — pasif, onaysız, kanıt tuzu silinmiş, adı önekli (bir kez).
  UPDATE public.devices SET "isActive" = false, status = 'PENDING', "proofSalt" = NULL, "proofIssuedAt" = NULL, "proofConfirmedAt" = NULL,
    name = CASE WHEN starts_with(name, ${lit(CIHAZ_ONEKI)}) THEN name ELSE left(${lit(CIHAZ_ONEKI)} || name, 100) END
  WHERE id NOT IN (SELECT id FROM aktar_deneme.devices);
  ${kopyala("devices")}

  -- ④ Ayarlar: kurulum-özel + modül/bayrak/özellik anahtarları DENEME'den (satırı olmayan = varsayılan, KAYNAK'ınki
  --    da girmez); belge tasarımı ve kalan iş ayarları KAYNAK'tan.
  DELETE FROM public.system_settings WHERE aktar_kontrol.deneme_anahtari(key);
  ${kopyala("system_settings", "WHERE aktar_kontrol.deneme_anahtari(key)")}
  -- ④b DENEME'de kapalı (ya da satırsız) her modül AÇIK; açık olanın satırı bayt-eşit kalır.
  INSERT INTO aktar_kontrol.acilan_modul
    SELECT b.key, s.key IS NOT NULL FROM aktar_kontrol.bayrak_ayar b LEFT JOIN public.system_settings s ON s.key = b.key
     WHERE b.modul AND NOT coalesce(aktar_kontrol.acik_mi(s.value::jsonb), false);
  INSERT INTO public.system_settings (key, value, description, "updatedById", "createdAt", "updatedAt")
    SELECT key, 'true'::jsonb, ${lit(MODUL_ACIKLAMA)}, NULL, now(), now() FROM aktar_kontrol.acilan_modul
  ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, description = EXCLUDED.description, "updatedById" = NULL, "updatedAt" = now();

  -- ⑤ Audit: YALNIZ DENEME'nin satırları (hash zinciri aynen); KAYNAK'ın hiçbir satırı taşınmaz.
  DELETE FROM public.system_logs;
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

  -- ⑨ Eşitleme konumu yalnız tur sayacı; silme işareti yok.
  SELECT count(*) INTO n FROM public.sync_watermarks WHERE source <> 'tur';
  SELECT count(*) INTO m FROM public.sync_marks;
  IF n + m > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'esitleme', format('filigran %s · işaret %s', n, m));
  ELSE PERFORM aktar_kontrol.yaz('OK', 'esitleme', 'filigran sıfır (ilk tur TAM)'); END IF;
END $v$;
${kuralDogrulaSql()}
SELECT durum || '|' || ad || '|' || coalesce(detay, '') FROM aktar_kontrol.sonuc ORDER BY sira;
`;
}

/**
 * Kullanıcı kararı 2026-10-16 kuralları (cihaz · ayar/modül · audit) — ayrı blok: negatif sondalar YALNIZ bunu koşar
 * (bozulmuş kopya tx içinde, ROLLBACK). Kuralların her biri kendi HATA adını yazar; sonda o adı bekler.
 */
export function kuralDogrulaSql() {
  return `
DO $k$
DECLARE n bigint; m bigint; k text;
BEGIN
  -- ④ Cihazlar: DENEME'ninkiler bayt-eşit; KAYNAK'ınkiler onaysız + pasif + sırsız; adı tam BİR kez önekli.
  k := aktar_kontrol.kolonlar('devices');
  EXECUTE format('SELECT count(*) FROM (SELECT %s FROM aktar_deneme.devices EXCEPT ALL SELECT %s FROM public.devices) x', k, k) INTO n;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'deneme-cihaz', format('%s DENEME cihazı birebir değil', n)); END IF;
  SELECT count(*) INTO n FROM public.devices WHERE id NOT IN (SELECT id FROM aktar_deneme.devices) AND ("isActive" OR status <> 'PENDING' OR "proofSalt" IS NOT NULL);
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'kaynak-cihaz', format('%s KAYNAK cihazı etkin/onaylı', n)); END IF;
  SELECT count(*) INTO n FROM public.devices d JOIN aktar_kontrol.cihaz_once o USING (id)
   WHERE d.id NOT IN (SELECT id FROM aktar_deneme.devices)
     AND d.name IS DISTINCT FROM (CASE WHEN starts_with(o.name, ${lit(CIHAZ_ONEKI)}) THEN o.name ELSE left(${lit(CIHAZ_ONEKI)} || o.name, 100) END);
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'kaynak-cihaz-ad', format('%s KAYNAK cihaz adı önekli değil ya da çift önekli', n)); END IF;
  PERFORM aktar_kontrol.yaz('OK', 'cihaz', (SELECT format('DENEME %s · KAYNAK %s (onaysız+pasif, önekli %s)',
    count(*) FILTER (WHERE id IN (SELECT id FROM aktar_deneme.devices)), count(*) FILTER (WHERE id NOT IN (SELECT id FROM aktar_deneme.devices)),
    count(*) FILTER (WHERE id NOT IN (SELECT id FROM aktar_deneme.devices) AND starts_with(name, ${lit(CIHAZ_ONEKI)}))) FROM public.devices));

  -- ⑤ Ayarlar: DENEME anahtarları (kurulum ∪ bayrak, modül HARİÇ) DENEME ile iki yönlü eşit; kurulum kimliği DENEME'nin.
  SELECT count(*) INTO n FROM (
    (SELECT key, value::text FROM public.system_settings WHERE aktar_kontrol.deneme_anahtari(key) AND key NOT IN (SELECT key FROM aktar_kontrol.acilan_modul)
     EXCEPT SELECT key, value::text FROM aktar_deneme.system_settings WHERE aktar_kontrol.deneme_anahtari(key))
    UNION ALL
    (SELECT key, value::text FROM aktar_deneme.system_settings WHERE aktar_kontrol.deneme_anahtari(key) AND key NOT IN (SELECT key FROM aktar_kontrol.acilan_modul)
     EXCEPT SELECT key, value::text FROM public.system_settings WHERE aktar_kontrol.deneme_anahtari(key))) x;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'bayrak-ayar', format('%s kurulum/bayrak ayarı DENEME ile eşit değil (KAYNAK bayrağı sızmış ya da DENEME değeri kaybolmuş)', n)); END IF;
  -- Modüller: HEPSİ açık; DENEME'de açık olanlar dokunulmadı; bağımlılık çiftleri tutarlı.
  SELECT count(*) INTO n FROM aktar_kontrol.bayrak_ayar b LEFT JOIN public.system_settings s USING (key)
   WHERE b.modul AND NOT coalesce(aktar_kontrol.acik_mi(s.value::jsonb), false);
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'modul-acik', format('%s modül kapalı', n)); END IF;
  SELECT count(*) INTO n FROM aktar_kontrol.modul_bagimlilik m
    LEFT JOIN public.system_settings b ON b.key = m.bagimli LEFT JOIN public.system_settings o ON o.key = m.on_kosul
   WHERE coalesce(aktar_kontrol.acik_mi(b.value::jsonb), false) AND NOT coalesce(aktar_kontrol.acik_mi(o.value::jsonb), false);
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'modul-bagimlilik', format('%s bağımlı modül ön koşulsuz açık', n)); END IF;
  -- KAYNAK'tan kalan anahtarlar (belge tasarımı + iş ayarı) KAYNAK'ın değerini taşır.
  SELECT count(*) INTO n FROM (
    (SELECT key, value::text FROM public.system_settings WHERE NOT aktar_kontrol.deneme_anahtari(key)
     EXCEPT SELECT key, value::text FROM aktar_kontrol.ayar_once WHERE NOT aktar_kontrol.deneme_anahtari(key))
    UNION ALL
    (SELECT key, value::text FROM aktar_kontrol.ayar_once WHERE NOT aktar_kontrol.deneme_anahtari(key)
     EXCEPT SELECT key, value::text FROM public.system_settings WHERE NOT aktar_kontrol.deneme_anahtari(key))) x;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'is-ayar', format('%s iş ayarı KAYNAK ile eşit değil', n)); END IF;
  IF (SELECT value FROM public.system_settings WHERE key = 'system.installationId')
     IS DISTINCT FROM (SELECT value FROM aktar_deneme.system_settings WHERE key = 'system.installationId') THEN
    PERFORM aktar_kontrol.yaz('HATA', 'kurulum-kimligi', 'system.installationId DENEME''ninki değil');
  ELSE PERFORM aktar_kontrol.yaz('OK', 'kurulum-kimligi', 'system.installationId = DENEME'); END IF;
  PERFORM aktar_kontrol.yaz('OK', 'ayar', (SELECT format('bayrak anahtarı %s (DENEME satırı %s) · modül %s, açılan %s: %s · KAYNAK iş ayarı %s',
    (SELECT count(*) FROM aktar_kontrol.bayrak_ayar),
    (SELECT count(*) FROM aktar_deneme.system_settings s JOIN aktar_kontrol.bayrak_ayar USING (key)),
    (SELECT count(*) FROM aktar_kontrol.bayrak_ayar WHERE modul),
    (SELECT count(*) FROM aktar_kontrol.acilan_modul),
    coalesce((SELECT string_agg(key, ', ' ORDER BY key) FROM aktar_kontrol.acilan_modul), '-'),
    (SELECT count(*) FROM public.system_settings WHERE NOT aktar_kontrol.deneme_anahtari(key)))));

  -- ⑧ Audit: public.system_logs = DENEME'ninki, iki yönlü (KAYNAK'ın tek satırı bile yok; zincir aynen).
  k := aktar_kontrol.kolonlar('system_logs');
  EXECUTE format('SELECT (SELECT count(*) FROM (SELECT %s FROM public.system_logs EXCEPT ALL SELECT %s FROM aktar_deneme.system_logs) a), (SELECT count(*) FROM (SELECT %s FROM aktar_deneme.system_logs EXCEPT ALL SELECT %s FROM public.system_logs) b)', k, k, k, k) INTO n, m;
  IF n > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'audit-yalniz-deneme', format('%s DENEME dışı audit satırı', n)); END IF;
  IF m > 0 THEN PERFORM aktar_kontrol.yaz('HATA', 'audit-zincir', format('%s DENEME audit satırı eksik/değişmiş', m)); END IF;
  PERFORM aktar_kontrol.yaz('OK', 'audit', (SELECT format('%s satır = DENEME (zincirli %s) · KAYNAK %s satırı taşınmadı',
    count(*), count(*) FILTER (WHERE "chainSeq" IS NOT NULL), (SELECT o.n FROM aktar_kontrol.sayim_once o WHERE o.tablo = 'system_logs')) FROM public.system_logs));
END $k$;`;
}

/**
 * Negatif sondalar: her biri HEDEF'i tx içinde BİLEREK bozar, yalnız kural bloğunu koşar, beklenen HATA adını arar,
 * ROLLBACK. Yakalanmayan sonda = doğrulama kör ⇒ betik 1 ile çıkar.
 */
export const SONDALAR = [
  { ad: "modül kapatıldı", bekle: "modul-acik",
    boz: `UPDATE public.system_settings SET value = 'false'::jsonb WHERE key = (SELECT min(key) FROM aktar_kontrol.bayrak_ayar WHERE modul);` },
  { ad: "bağımlı modül ön koşulsuz", bekle: "modul-bagimlilik",
    boz: `UPDATE public.system_settings SET value = 'false'::jsonb WHERE key = (SELECT min(on_kosul) FROM aktar_kontrol.modul_bagimlilik);` },
  { ad: "KAYNAK bayrağı sızdı", bekle: "bayrak-ayar",
    boz: `INSERT INTO public.system_settings (key, value, "createdAt", "updatedAt")
            SELECT b.key, coalesce((SELECT value FROM aktar_kontrol.ayar_once WHERE key = b.key), '"sonda"'::jsonb), now(), now()
              FROM aktar_kontrol.bayrak_ayar b WHERE NOT b.modul AND b.key NOT IN (SELECT key FROM public.system_settings)
             ORDER BY (b.key IN (SELECT key FROM aktar_kontrol.ayar_once)) DESC, b.key LIMIT 1;` },
  { ad: "KAYNAK audit satırı taşındı", bekle: "audit-yalniz-deneme",
    boz: `CREATE TEMP TABLE sonda_log ON COMMIT DROP AS SELECT * FROM public.system_logs ORDER BY "createdAt" LIMIT 1;
          UPDATE sonda_log SET id = gen_random_uuid(), "chainSeq" = NULL, "createdAt" = "createdAt" - interval '30 days';
          INSERT INTO public.system_logs SELECT * FROM sonda_log;` },
  { ad: "KAYNAK cihaz adı öneksiz", bekle: "kaynak-cihaz-ad",
    boz: `UPDATE public.devices d SET name = o.name FROM aktar_kontrol.cihaz_once o
           WHERE d.id = o.id AND d.id = (SELECT min(id::text)::uuid FROM public.devices WHERE id NOT IN (SELECT id FROM aktar_deneme.devices))
             AND NOT starts_with(o.name, ${lit(CIHAZ_ONEKI)});` },
  { ad: "KAYNAK cihaz adı çift önekli", bekle: "kaynak-cihaz-ad",
    boz: `UPDATE public.devices SET name = left(${lit(CIHAZ_ONEKI)} || name, 100)
           WHERE id = (SELECT min(id::text)::uuid FROM public.devices WHERE id NOT IN (SELECT id FROM aktar_deneme.devices));` },
  { ad: "KAYNAK cihazı onaylı", bekle: "kaynak-cihaz",
    boz: `UPDATE public.devices SET status = 'APPROVED', "isActive" = true
           WHERE id = (SELECT min(id::text)::uuid FROM public.devices WHERE id NOT IN (SELECT id FROM aktar_deneme.devices));` },
];

/** Tek sondanın SQL'i: bozma + kural doğrulaması + yakalanan HATA adları; hep ROLLBACK. */
export const sondaSql = (sonda) => `
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM aktar_kontrol.sonuc;
${sonda.boz}
${kuralDogrulaSql()}
SELECT 'HATA|' || ad FROM aktar_kontrol.sonuc WHERE durum = 'HATA';
ROLLBACK;
`;
