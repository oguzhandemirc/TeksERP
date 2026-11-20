-- =============================================================================
-- D7 görünüm tercihleri + D8 "şimdi eşitle" — YALNIZ EKLEME (iki yeni tablo; mevcut tabloya dokunulmaz).
--   view_preferences: hesabın liste sıralaması / görünen sütunları (KULLANICI TERCİHİ, iş kararı okumaz).
--   sync_requests:    tesis başına TEK durum satırı; hesap işaret açar, fabrika `rapor/al` claim'inde tüketir.
-- RLS + destek kapısı diğer kiracı tablolarıyla aynı kural; yetkiler `src/lib/db-grants.ts`.
-- =============================================================================

CREATE TABLE "view_preferences" (
    "id" UUID NOT NULL,
    "tesis_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "view_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "view_preferences_tesis_id_account_id_key_key" ON "view_preferences"("tesis_id", "account_id", "key");

-- Son sed: uygulama kapısı (anahtar listesi + 4096 bayt) aşılırsa DB de reddeder.
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_anahtar_bicimi" CHECK ("key" ~ '^[a-z][a-z.-]{0,39}$');
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_deger_boyutu" CHECK (octet_length("value"::text) <= 8192);

CREATE TABLE "sync_requests" (
    "id" UUID NOT NULL,
    "tesis_id" UUID NOT NULL,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL,
    "full_requested_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sync_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_requests_tesis_id_key" ON "sync_requests"("tesis_id");

-- Kapsam kapalı küme (tel `SYNC_NOW_SCOPES`); TAM isteğin damgası boş olamaz (TAM aralığı ona dayanır).
ALTER TABLE "sync_requests" ADD CONSTRAINT "sync_requests_kapsam" CHECK ("scope" IN ('KISMI', 'TAM'));
ALTER TABLE "sync_requests" ADD CONSTRAINT "sync_requests_tam_damgasi" CHECK ("scope" <> 'TAM' OR "full_requested_at" IS NOT NULL);

-- RLS — kiracı yalıtımı (tek yazar `src/lib/tenant.ts`); ayarsız bağlantıda sorgu HATA verir (fail-closed).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['view_preferences', 'sync_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tesis_yalitimi ON %I USING (tesis_id = current_setting(''app.tesis_id'')::uuid) '
      'WITH CHECK (tesis_id = current_setting(''app.tesis_id'')::uuid)', t);
  END LOOP;
END $$;

-- Destek rolü kapısı (RESTRICTIVE, yalnız SELECT; izin `destek_ac` kaydından) — diğer tablolarla aynı kural.
DO $$
DECLARE r text := current_database() || '_destek';
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['view_preferences', 'sync_requests'] LOOP
    EXECUTE format('CREATE POLICY destek_kapisi ON %I AS RESTRICTIVE FOR SELECT TO %I USING (tesis_id = (SELECT public.destek_tesisi()))', t, r);
  END LOOP;
END $$;
