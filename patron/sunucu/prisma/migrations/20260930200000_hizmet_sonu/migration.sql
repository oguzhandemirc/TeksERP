-- =============================================================================
-- HİZMET SONU (Ek-6/A §4) — bitiş damgası + imha kaydı. Yalnız EKLER: `service_ended_at` NULL doğar
-- (bugünkü davranış: hizmet açık sayılır, bakım işi ilk turda gerçeğe göre damgalar); mevcut tabloya
-- veri yazılmaz. Damganın TEK yazarı `src/services/service-lifecycle.ts` `refreshServiceEnd` (bakım tiki).
-- =============================================================================

-- Hizmetin bittiği an (abonelik bitişi / hak düşmesi / tesis kapanışı) — DONMUŞ: satıcı kipinde hak
-- donunca bitiş tarihi NULL gelir; damga olmasa 90 günlük salt okuma süresi hiç dolmazdı.
ALTER TABLE "facilities" ADD COLUMN "service_ended_at" TIMESTAMPTZ;

-- İmha kaydı (tutanak verisi, Ek-6/A §4.5 · §6): tesisin verisi silindikten SONRA da kalır (en az 3 yıl);
-- silinen verinin İÇERİĞİNİ taşımaz — tablo başına satır sayısı, neden, işlemi yapan, yedekten düşme tarihi.
CREATE TABLE "facility_destructions" (
    "id" UUID NOT NULL,
    "tesis_id" UUID NOT NULL,
    "facility_name" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "request_ref" VARCHAR(60),
    "operator" VARCHAR(120) NOT NULL,
    "service_ended_at" TIMESTAMPTZ,
    "deleted_counts" JSONB NOT NULL,
    "backup_clear_by" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_destructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facility_destructions_tesis_id_created_at_idx" ON "facility_destructions"("tesis_id", "created_at");

ALTER TABLE "facility_destructions" ADD CONSTRAINT "facility_destructions_reason_check"
  CHECK ("reason" IN ('SURE_DOLDU', 'ERKEN_TALEP'));
-- Erken imha yalnız yazılı talep numarasıyla (Ek-6/A §4.2); süre dolunca talep gerekmez.
ALTER TABLE "facility_destructions" ADD CONSTRAINT "facility_destructions_request_pair_check"
  CHECK (("reason" = 'ERKEN_TALEP') = ("request_ref" IS NOT NULL));

-- Kayıt değiştirilemez ve silinemez (tablo sahibi dahil; TRUNCATE da).
CREATE FUNCTION "kayit_degistirilemez"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% kaydı değiştirilemez ve silinemez', TG_TABLE_NAME;
END $$;
REVOKE ALL ON FUNCTION "kayit_degistirilemez"() FROM PUBLIC;
CREATE TRIGGER "facility_destructions_degismez" BEFORE UPDATE OR DELETE ON "facility_destructions"
  FOR EACH ROW EXECUTE FUNCTION "kayit_degistirilemez"();
CREATE TRIGGER "facility_destructions_bosaltilamaz" BEFORE TRUNCATE ON "facility_destructions"
  FOR EACH STATEMENT EXECUTE FUNCTION "kayit_degistirilemez"();

-- RLS — kiracı yalıtımı (kalıp ilk şemayla aynı). Çalışma rollerine yetki YOK: yalnız satıcı CLI'si (göç) yazar/okur.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facility_destructions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tesis_yalitimi ON %I USING (tesis_id = current_setting(''app.tesis_id'')::uuid) '
      'WITH CHECK (tesis_id = current_setting(''app.tesis_id'')::uuid)', t);
  END LOOP;
END $$;
