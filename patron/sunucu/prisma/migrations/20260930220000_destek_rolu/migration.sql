-- =============================================================================
-- DESTEK ROLÜ + ERİŞİM KAYDI (Ek-6/B §3.2): Lisans Veren çalışanının bulut DB'sine DOĞRUDAN destek sorgusu
-- ayrı, SALT OKUNUR, RLS'ye tabi (NOBYPASSRLS) bir rolle yapılır ve her içerik erişimi SİLİNEMEYEN bir kayda
-- yazılır: kim · ne zaman · hangi tesis · hangi veri kümesi · gerekçe (talep no).
-- Neden GUC değil kayıt: `app.tesis_id` özel ayarını HER rol `set_config` ile yazabilir — destek rolü onu
-- başka tesise çevirebilirdi. Kapı bu yüzden sunucu tarafı kayıttır: `destek_ac` (SECURITY DEFINER) oturumun
-- (pid + backend_start) süreli iznini `support_access`e yazar; her okunabilir tabloda RESTRICTIVE `destek_kapisi`
-- politikası satırı YALNIZ o izne bağlar (`tesis_id = (SELECT destek_tesisi())` — alt sorgu sorgu başına bir kez).
-- Rol küme düzeyindedir; politikalar onu adıyla andığı için göç NOLOGIN olarak (idempotent) kurar. Adı
-- `<veritabanı>_destek` (üretimde `patron_destek`); yetkileri `src/lib/db-grants.ts` SUPPORT_GRANTS (kolon düzeyi,
-- sır kolonları hariç) → `scripts/db-rolleri.ts`. Giriş yetkisi (LOGIN) runbook'la açılır/kapanır.
-- Yalnız EKLER; mevcut tablo ve politikalar değişmez (restrictive politika yalnız destek rolüne uygulanır).
-- =============================================================================

DO $$
DECLARE r text := current_database() || '_destek';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT', r);
  END IF;
END $$;

-- CreateTable
CREATE TABLE "support_access" (
    "id" UUID NOT NULL,
    "tesis_id" UUID NOT NULL,
    "db_user" VARCHAR(63) NOT NULL,
    "pid" INTEGER NOT NULL,
    "backend_start" TIMESTAMPTZ NOT NULL,
    "ticket" VARCHAR(60) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "scope" VARCHAR(200) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "close_reason" VARCHAR(20),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_access_tesis_id_created_at_idx" ON "support_access"("tesis_id", "created_at");

-- CreateIndex
CREATE INDEX "support_access_pid_backend_start_idx" ON "support_access"("pid", "backend_start");

ALTER TABLE "support_access" ADD CONSTRAINT "support_access_close_pair_check"
  CHECK (("closed_at" IS NULL) = ("close_reason" IS NULL));
ALTER TABLE "support_access" ADD CONSTRAINT "support_access_close_reason_check"
  CHECK ("close_reason" IS NULL OR "close_reason" IN ('KAPATILDI', 'YENI_ERISIM', 'ROL_KAPATILDI'));
ALTER TABLE "support_access" ADD CONSTRAINT "support_access_expiry_check"
  CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '8 hours');

-- Kayıt SİLİNEMEZ; güncellemede yalnız açık kaydın kapanış damgası yazılır (tablo sahibi dahil; TRUNCATE da).
CREATE FUNCTION "destek_kaydi_yalniz_kapanis"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL
     OR (NEW.id, NEW.tesis_id, NEW.db_user, NEW.pid, NEW.backend_start, NEW.ticket, NEW.reason, NEW.scope, NEW.expires_at, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.tesis_id, OLD.db_user, OLD.pid, OLD.backend_start, OLD.ticket, OLD.reason, OLD.scope, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'support_access kaydı silinemez; yalnız açık erişimin kapanışı yazılır';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION "destek_kaydi_yalniz_kapanis"() FROM PUBLIC;
CREATE TRIGGER "support_access_degismez" BEFORE UPDATE OR DELETE ON "support_access"
  FOR EACH ROW EXECUTE FUNCTION "destek_kaydi_yalniz_kapanis"();
CREATE TRIGGER "support_access_bosaltilamaz" BEFORE TRUNCATE ON "support_access"
  FOR EACH STATEMENT EXECUTE FUNCTION "kayit_degistirilemez"();

-- RLS — kiracı yalıtımı (kalıp ilk şemayla aynı). Uygulama rolü OKUR (tesis yöneticisinin dökümü); destek rolü okuyamaz.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_access'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tesis_yalitimi ON %I USING (tesis_id = current_setting(''app.tesis_id'')::uuid) '
      'WITH CHECK (tesis_id = current_setting(''app.tesis_id'')::uuid)', t);
  END LOOP;
END $$;

-- Bu oturumun (pid + başlangıç anı; pid yeniden kullanılsa da başka oturum izni devralamaz) açık ve süresi
-- dolmamış destek izninin tesisi; yoksa NULL (politika hiçbir satırı açmaz).
CREATE FUNCTION public.destek_tesisi() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT a.tesis_id FROM public.support_access a
   WHERE a.pid = pg_backend_pid()
     AND a.backend_start = (SELECT s.backend_start FROM pg_stat_activity s WHERE s.pid = pg_backend_pid())
     AND a.closed_at IS NULL AND a.expires_at > now()
   ORDER BY a.created_at DESC
   LIMIT 1
$$;

-- Destek erişimini AÇAR: kayıt (kim · ne zaman · tesis · kapsam · gerekçe · talep no · bitiş) + oturum ayarları.
-- Aynı oturumun önceki açık izni kapanır (oturum başına tek tesis).
CREATE FUNCTION public.destek_ac(p_tesis uuid, p_talep text, p_gerekce text, p_kapsam text, p_dakika integer DEFAULT 120) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_start timestamptz;
  v_id uuid := gen_random_uuid();
  v_proj text;
BEGIN
  IF p_tesis IS NULL OR NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.tesis_id = p_tesis) THEN
    RAISE EXCEPTION 'Tesis bulunamadı';
  END IF;
  IF p_talep IS NULL OR length(btrim(p_talep)) NOT BETWEEN 3 AND 60 THEN
    RAISE EXCEPTION 'Destek talebi numarası zorunlu (3–60 karakter)';
  END IF;
  IF p_gerekce IS NULL OR length(btrim(p_gerekce)) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Gerekçe zorunlu (10–500 karakter)';
  END IF;
  IF p_kapsam IS NULL OR length(btrim(p_kapsam)) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'Veri kümesi (kapsam) zorunlu (3–200 karakter)';
  END IF;
  IF p_dakika IS NULL OR p_dakika NOT BETWEEN 1 AND 480 THEN
    RAISE EXCEPTION 'Süre 1–480 dakika olmalı';
  END IF;
  SELECT s.backend_start INTO v_start FROM pg_stat_activity s WHERE s.pid = pg_backend_pid();
  UPDATE public.support_access SET closed_at = now(), close_reason = 'YENI_ERISIM'
   WHERE pid = pg_backend_pid() AND backend_start = v_start AND closed_at IS NULL;
  INSERT INTO public.support_access (id, tesis_id, db_user, pid, backend_start, ticket, reason, scope, expires_at)
  VALUES (v_id, p_tesis, session_user, pg_backend_pid(), v_start, btrim(p_talep), btrim(p_gerekce), btrim(p_kapsam),
          now() + make_interval(mins => p_dakika));
  SELECT string_agg(DISTINCT x.projection, ',') INTO v_proj FROM (
    SELECT projection FROM public.projection_rows WHERE tesis_id = p_tesis
    UNION SELECT projection FROM public.report_results WHERE tesis_id = p_tesis) x;
  PERFORM set_config('app.tesis_id', p_tesis::text, false);
  PERFORM set_config('app.projeksiyonlar', COALESCE(v_proj, ''), false);
  RETURN v_id;
END $$;

-- Destek erişimini KAPATIR (bu oturumun açık izni) ve oturum ayarlarını sıfırlar (sonraki sorgu HATA verir).
CREATE FUNCTION public.destek_kapat() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_start timestamptz;
  v_n integer;
BEGIN
  SELECT s.backend_start INTO v_start FROM pg_stat_activity s WHERE s.pid = pg_backend_pid();
  UPDATE public.support_access SET closed_at = now(), close_reason = 'KAPATILDI'
   WHERE pid = pg_backend_pid() AND backend_start = v_start AND closed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.tesis_id', '', false);
  PERFORM set_config('app.projeksiyonlar', '', false);
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.destek_tesisi() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.destek_ac(uuid, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.destek_kapat() FROM PUBLIC;

-- Destek rolü: yalnız bu üç fonksiyonu çalıştırır; okunabilir her tabloda RESTRICTIVE kapı (tablo listesi
-- `src/lib/db-grants.ts` SUPPORT_GRANTS ile BİREBİR — bekçi `test_destek_rolu` iki yönlü ölçer).
DO $$
DECLARE
  r text := current_database() || '_destek';
  tablo text;
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.destek_tesisi(), public.destek_ac(uuid, text, text, text, integer), public.destek_kapat() TO %I', r);
  FOR tablo IN SELECT unnest(ARRAY[
    'facilities', 'installations', 'accounts', 'sessions', 'account_audit', 'operation_receipts',
    'inbox_messages', 'report_requests', 'report_results', 'push_devices', 'notification_defaults',
    'notification_preferences', 'notifications', 'projection_rows', 'sync_watermarks', 'package_receipts',
    'sync_state', 'full_sync_runs', 'request_nonces'
  ]) LOOP
    EXECUTE format('CREATE POLICY destek_kapisi ON %I AS RESTRICTIVE FOR SELECT TO %I USING (tesis_id = (SELECT public.destek_tesisi()))', tablo, r);
  END LOOP;
END $$;
