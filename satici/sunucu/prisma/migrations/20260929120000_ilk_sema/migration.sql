-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LisansSinifi" AS ENUM ('URETIM', 'TEST', 'DR', 'DEMO', 'BAYI', 'BARINDIRILAN');

-- CreateEnum
CREATE TYPE "KurulumDurumu" AS ENUM ('ETKINLESMEDI', 'ETKIN', 'DEVREDILDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "KodDurumu" AS ENUM ('AKTIF', 'KULLANILDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "TasimaDurumu" AS ENUM ('BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI');

-- CreateEnum
CREATE TYPE "ZincirKarari" AS ENUM ('ETKINLESTIRME', 'NORMAL', 'YAKALA', 'CATAL', 'TASIMA');

-- CreateEnum
CREATE TYPE "YaptirimTuru" AS ENUM ('K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'ZORLAMA', 'GECERLILIK', 'GERI_AL');

-- CreateEnum
CREATE TYPE "PlanliEylemDurumu" AS ENUM ('BEKLIYOR', 'UYGULANDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "TaksitKalemDurumu" AS ENUM ('BEKLIYOR', 'ODENDI', 'GECIKTI', 'IPTAL');

-- CreateEnum
CREATE TYPE "KopyaUyariTuru" AS ENUM ('ZINCIR_CATALI', 'PARMAK_IZI_UYUSMAZ', 'AYNI_PARMAK_IZI_TEKRAR');

-- CreateEnum
CREATE TYPE "KopyaUyariDurumu" AS ENUM ('ACIK', 'KAPANDI');

-- CreateEnum
CREATE TYPE "AnahtarTuru" AS ENUM ('KOK', 'HAZIRLIK_KOK', 'ALT', 'INDIRME', 'BAYI');

-- CreateEnum
CREATE TYPE "AnahtarDurumu" AS ENUM ('AKTIF', 'EMEKLI', 'IPTAL');

-- CreateTable
CREATE TABLE "musteri" (
    "id" UUID NOT NULL,
    "ad" VARCHAR(200) NOT NULL,
    "vergiNo" VARCHAR(20),
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "musteri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tesis" (
    "id" UUID NOT NULL,
    "musteriId" UUID NOT NULL,
    "ad" VARCHAR(200) NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kurulum" (
    "id" UUID NOT NULL,
    "tesisId" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "ad" VARCHAR(200),
    "sinif" "LisansSinifi" NOT NULL,
    "kanalKodu" VARCHAR(40) NOT NULL,
    "durum" "KurulumDurumu" NOT NULL DEFAULT 'ETKINLESMEDI',
    "acikAnahtar" VARCHAR(64),
    "anahtarKimligi" VARCHAR(64),
    "kabulEdilenParmakIzi" JSONB,
    "sonKiraId" UUID,
    "zorlama" BOOLEAN NOT NULL DEFAULT false,
    "yoklamaAraligiDk" INTEGER NOT NULL DEFAULT 60,
    "platform" VARCHAR(10),
    "sonOrtam" JSONB,
    "sonSaglik" JSONB,
    "sonYoklamaZamani" TIMESTAMPTZ,
    "etkinlesmeZamani" TIMESTAMPTZ,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kurulum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hak" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "lisansNo" VARCHAR(20) NOT NULL,
    "moduller" TEXT[],
    "kalici" BOOLEAN NOT NULL DEFAULT false,
    "bakimBitis" TIMESTAMPTZ NOT NULL,
    "gecerlilikBitis" TIMESTAMPTZ,
    "guncelSurum" INTEGER NOT NULL DEFAULT 0,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hak_surumu" (
    "id" UUID NOT NULL,
    "hakId" UUID NOT NULL,
    "surum" INTEGER NOT NULL,
    "belge" TEXT NOT NULL,
    "imzalayanKid" VARCHAR(64) NOT NULL,
    "verilis" TIMESTAMPTZ NOT NULL,
    "sebep" VARCHAR(500) NOT NULL,
    "yapan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hak_surumu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kira" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "oncekiKiraId" UUID,
    "hakId" UUID NOT NULL,
    "hakSurum" INTEGER NOT NULL,
    "anahtarKimligi" VARCHAR(64) NOT NULL,
    "karar" "ZincirKarari" NOT NULL,
    "istemciParmakIzi" JSONB NOT NULL,
    "verilis" TIMESTAMPTZ NOT NULL,
    "bitis" TIMESTAMPTZ NOT NULL,
    "belge" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nonce_defteri" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "amac" VARCHAR(20) NOT NULL,
    "sonKullanim" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nonce_defteri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yoklama" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "sonuc" VARCHAR(40) NOT NULL,
    "kiraId" UUID,
    "durum" JSONB NOT NULL,
    "saat" JSONB NOT NULL,
    "ortam" JSONB NOT NULL,
    "saglik" JSONB NOT NULL,
    "gozlem" JSONB NOT NULL,
    "parmakIzi" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yoklama_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yaptirim_eylemi" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "tur" "YaptirimTuru" NOT NULL,
    "parametre" JSONB NOT NULL,
    "sebep" VARCHAR(500) NOT NULL,
    "yapan" VARCHAR(120) NOT NULL,
    "geriAlinanEylemId" UUID,
    "planliEylemId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yaptirim_eylemi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planli_eylem" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "tur" "YaptirimTuru" NOT NULL,
    "parametre" JSONB NOT NULL,
    "vade" TIMESTAMPTZ NOT NULL,
    "durum" "PlanliEylemDurumu" NOT NULL DEFAULT 'BEKLIYOR',
    "sebep" VARCHAR(500) NOT NULL,
    "yapan" VARCHAR(120) NOT NULL,
    "uygulamaZamani" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "planli_eylem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taksit_plani" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "aciklama" VARCHAR(500) NOT NULL,
    "uzatmaGun" INTEGER NOT NULL DEFAULT 15,
    "gecikmeGun" INTEGER NOT NULL DEFAULT 15,
    "kisitlamaGun" INTEGER NOT NULL DEFAULT 15,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "yapan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "taksit_plani_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taksit_kalemi" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "vade" TIMESTAMPTZ NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "durum" "TaksitKalemDurumu" NOT NULL DEFAULT 'BEKLIYOR',
    "odemeZamani" TIMESTAMPTZ,
    "yaptirimEylemiId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "taksit_kalemi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etkinlestirme_kodu" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "kodOzeti" VARCHAR(64) NOT NULL,
    "kodSonu" VARCHAR(4) NOT NULL,
    "durum" "KodDurumu" NOT NULL DEFAULT 'AKTIF',
    "gecerlilikBitis" TIMESTAMPTZ NOT NULL,
    "kullanimZamani" TIMESTAMPTZ,
    "kullananAnahtarKimligi" VARCHAR(64),
    "kiraId" UUID,
    "yapan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "etkinlestirme_kodu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasima_talebi" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "yeniAcikAnahtar" VARCHAR(64) NOT NULL,
    "yeniAnahtarKimligi" VARCHAR(64) NOT NULL,
    "yeniParmakIzi" JSONB NOT NULL,
    "ortam" JSONB NOT NULL,
    "gerekce" VARCHAR(500),
    "durum" "TasimaDurumu" NOT NULL DEFAULT 'BEKLIYOR',
    "kararZamani" TIMESTAMPTZ,
    "kararVeren" VARCHAR(120),
    "kararSebebi" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tasima_talebi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kopya_uyarisi" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "tur" "KopyaUyariTuru" NOT NULL,
    "durum" "KopyaUyariDurumu" NOT NULL DEFAULT 'ACIK',
    "ilkGorulme" TIMESTAMPTZ NOT NULL,
    "sonGorulme" TIMESTAMPTZ NOT NULL,
    "gorulmeSayisi" INTEGER NOT NULL DEFAULT 1,
    "sahipParmakIzi" JSONB,
    "digerParmakIzi" JSONB NOT NULL,
    "redZamani" TIMESTAMPTZ,
    "kapanisZamani" TIMESTAMPTZ,
    "kapatan" VARCHAR(120),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kopya_uyarisi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kurulum_kaydi" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "olay" VARCHAR(40) NOT NULL,
    "anahtarKimligi" VARCHAR(64),
    "acikAnahtar" VARCHAR(64),
    "eskiAnahtarKimligi" VARCHAR(64),
    "eskiAcikAnahtar" VARCHAR(64),
    "ayrinti" JSONB,
    "yapan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kurulum_kaydi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anahtar_kaydi" (
    "id" UUID NOT NULL,
    "kid" VARCHAR(80) NOT NULL,
    "tur" "AnahtarTuru" NOT NULL,
    "acikAnahtar" VARCHAR(64) NOT NULL,
    "siniflar" "LisansSinifi"[],
    "sertifika" TEXT,
    "baslangic" TIMESTAMPTZ,
    "bitis" TIMESTAMPTZ,
    "durum" "AnahtarDurumu" NOT NULL DEFAULT 'AKTIF',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "anahtar_kaydi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denetim" (
    "id" UUID NOT NULL,
    "olay" VARCHAR(60) NOT NULL,
    "varlik" VARCHAR(40) NOT NULL,
    "varlikId" VARCHAR(64),
    "yapan" VARCHAR(120) NOT NULL,
    "ozet" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denetim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tesis_musteriId_idx" ON "tesis"("musteriId");

-- CreateIndex
CREATE UNIQUE INDEX "kurulum_kurulumId_key" ON "kurulum"("kurulumId");

-- CreateIndex
CREATE UNIQUE INDEX "kurulum_anahtarKimligi_key" ON "kurulum"("anahtarKimligi");

-- CreateIndex
CREATE UNIQUE INDEX "kurulum_sonKiraId_key" ON "kurulum"("sonKiraId");

-- CreateIndex
CREATE INDEX "kurulum_tesisId_idx" ON "kurulum"("tesisId");

-- CreateIndex
CREATE UNIQUE INDEX "hak_lisansNo_key" ON "hak"("lisansNo");

-- CreateIndex
CREATE INDEX "hak_kurulumId_idx" ON "hak"("kurulumId");

-- CreateIndex
CREATE UNIQUE INDEX "hak_surumu_hakId_surum_key" ON "hak_surumu"("hakId", "surum");

-- CreateIndex
CREATE INDEX "kira_kurulumId_createdAt_idx" ON "kira"("kurulumId", "createdAt");

-- CreateIndex
CREATE INDEX "kira_oncekiKiraId_idx" ON "kira"("oncekiKiraId");

-- CreateIndex
CREATE INDEX "nonce_defteri_sonKullanim_idx" ON "nonce_defteri"("sonKullanim");

-- CreateIndex
CREATE UNIQUE INDEX "nonce_defteri_kurulumId_nonce_key" ON "nonce_defteri"("kurulumId", "nonce");

-- CreateIndex
CREATE INDEX "yoklama_kurulumId_createdAt_idx" ON "yoklama"("kurulumId", "createdAt");

-- CreateIndex
CREATE INDEX "yoklama_createdAt_idx" ON "yoklama"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "yaptirim_eylemi_geriAlinanEylemId_key" ON "yaptirim_eylemi"("geriAlinanEylemId");

-- CreateIndex
CREATE UNIQUE INDEX "yaptirim_eylemi_planliEylemId_key" ON "yaptirim_eylemi"("planliEylemId");

-- CreateIndex
CREATE INDEX "yaptirim_eylemi_kurulumId_createdAt_idx" ON "yaptirim_eylemi"("kurulumId", "createdAt");

-- CreateIndex
CREATE INDEX "planli_eylem_durum_vade_idx" ON "planli_eylem"("durum", "vade");

-- CreateIndex
CREATE INDEX "taksit_plani_kurulumId_idx" ON "taksit_plani"("kurulumId");

-- CreateIndex
CREATE UNIQUE INDEX "taksit_kalemi_yaptirimEylemiId_key" ON "taksit_kalemi"("yaptirimEylemiId");

-- CreateIndex
CREATE INDEX "taksit_kalemi_durum_vade_idx" ON "taksit_kalemi"("durum", "vade");

-- CreateIndex
CREATE UNIQUE INDEX "taksit_kalemi_planId_sira_key" ON "taksit_kalemi"("planId", "sira");

-- CreateIndex
CREATE UNIQUE INDEX "etkinlestirme_kodu_kodOzeti_key" ON "etkinlestirme_kodu"("kodOzeti");

-- CreateIndex
CREATE INDEX "etkinlestirme_kodu_kurulumId_idx" ON "etkinlestirme_kodu"("kurulumId");

-- CreateIndex
CREATE INDEX "tasima_talebi_durum_idx" ON "tasima_talebi"("durum");

-- CreateIndex
CREATE UNIQUE INDEX "tasima_talebi_kurulumId_yeniAnahtarKimligi_key" ON "tasima_talebi"("kurulumId", "yeniAnahtarKimligi");

-- CreateIndex
CREATE INDEX "kopya_uyarisi_kurulumId_durum_idx" ON "kopya_uyarisi"("kurulumId", "durum");

-- CreateIndex
CREATE INDEX "kurulum_kaydi_kurulumId_createdAt_idx" ON "kurulum_kaydi"("kurulumId", "createdAt");

-- CreateIndex
CREATE INDEX "kurulum_kaydi_eskiAnahtarKimligi_idx" ON "kurulum_kaydi"("eskiAnahtarKimligi");

-- CreateIndex
CREATE UNIQUE INDEX "anahtar_kaydi_kid_key" ON "anahtar_kaydi"("kid");

-- CreateIndex
CREATE INDEX "denetim_varlik_varlikId_idx" ON "denetim"("varlik", "varlikId");

-- CreateIndex
CREATE INDEX "denetim_createdAt_idx" ON "denetim"("createdAt");

-- AddForeignKey
ALTER TABLE "tesis" ADD CONSTRAINT "tesis_musteriId_fkey" FOREIGN KEY ("musteriId") REFERENCES "musteri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_tesisId_fkey" FOREIGN KEY ("tesisId") REFERENCES "tesis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_sonKiraId_fkey" FOREIGN KEY ("sonKiraId") REFERENCES "kira"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hak" ADD CONSTRAINT "hak_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hak_surumu" ADD CONSTRAINT "hak_surumu_hakId_fkey" FOREIGN KEY ("hakId") REFERENCES "hak"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kira" ADD CONSTRAINT "kira_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kira" ADD CONSTRAINT "kira_hakId_fkey" FOREIGN KEY ("hakId") REFERENCES "hak"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kira" ADD CONSTRAINT "kira_oncekiKiraId_fkey" FOREIGN KEY ("oncekiKiraId") REFERENCES "kira"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nonce_defteri" ADD CONSTRAINT "nonce_defteri_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yoklama" ADD CONSTRAINT "yoklama_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yaptirim_eylemi" ADD CONSTRAINT "yaptirim_eylemi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yaptirim_eylemi" ADD CONSTRAINT "yaptirim_eylemi_geriAlinanEylemId_fkey" FOREIGN KEY ("geriAlinanEylemId") REFERENCES "yaptirim_eylemi"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yaptirim_eylemi" ADD CONSTRAINT "yaptirim_eylemi_planliEylemId_fkey" FOREIGN KEY ("planliEylemId") REFERENCES "planli_eylem"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planli_eylem" ADD CONSTRAINT "planli_eylem_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_plani" ADD CONSTRAINT "taksit_plani_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_kalemi" ADD CONSTRAINT "taksit_kalemi_planId_fkey" FOREIGN KEY ("planId") REFERENCES "taksit_plani"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_kalemi" ADD CONSTRAINT "taksit_kalemi_yaptirimEylemiId_fkey" FOREIGN KEY ("yaptirimEylemiId") REFERENCES "yaptirim_eylemi"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etkinlestirme_kodu" ADD CONSTRAINT "etkinlestirme_kodu_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etkinlestirme_kodu" ADD CONSTRAINT "etkinlestirme_kodu_kiraId_fkey" FOREIGN KEY ("kiraId") REFERENCES "kira"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasima_talebi" ADD CONSTRAINT "tasima_talebi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kopya_uyarisi" ADD CONSTRAINT "kopya_uyarisi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kurulum_kaydi" ADD CONSTRAINT "kurulum_kaydi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- DB SEDDİ — uygulama kurallarının veritabanı ikizi (çift yüklem: durum ↔ damga)
-- =============================================================================
ALTER TABLE "hak_surumu" ADD CONSTRAINT "hak_surumu_surum_pozitif" CHECK ("surum" >= 1);
ALTER TABLE "hak" ADD CONSTRAINT "hak_guncel_surum_negatif_degil" CHECK ("guncelSurum" >= 0);
ALTER TABLE "kira" ADD CONSTRAINT "kira_bitis_verilisten_sonra" CHECK ("bitis" > "verilis");
-- Zincirin kökü yalnız etkinleştirme ya da onaylı taşımadır; diğer her kira bir ucun çocuğudur.
ALTER TABLE "kira" ADD CONSTRAINT "kira_zincir_koku"
  CHECK ("karar" IN ('ETKINLESTIRME', 'TASIMA') OR "oncekiKiraId" IS NOT NULL);
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_etkin_anahtarli"
  CHECK ("durum" NOT IN ('ETKIN', 'DEVREDILDI')
         OR ("acikAnahtar" IS NOT NULL AND "anahtarKimligi" IS NOT NULL AND "kabulEdilenParmakIzi" IS NOT NULL));
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_yoklama_araligi" CHECK ("yoklamaAraligiDk" BETWEEN 5 AND 1440);
ALTER TABLE "etkinlestirme_kodu" ADD CONSTRAINT "kod_kullanim_ciftli"
  CHECK (("durum" = 'KULLANILDI') = ("kullanimZamani" IS NOT NULL AND "kullananAnahtarKimligi" IS NOT NULL));
ALTER TABLE "tasima_talebi" ADD CONSTRAINT "tasima_karar_ciftli" CHECK (("durum" = 'BEKLIYOR') = ("kararZamani" IS NULL));
ALTER TABLE "yaptirim_eylemi" ADD CONSTRAINT "yaptirim_ters_ciftli" CHECK (("tur" = 'GERI_AL') = ("geriAlinanEylemId" IS NOT NULL));
ALTER TABLE "yaptirim_eylemi" ADD CONSTRAINT "yaptirim_sebep_dolu" CHECK (length(btrim("sebep")) > 0);
ALTER TABLE "planli_eylem" ADD CONSTRAINT "planli_eylem_tur" CHECK ("tur" <> 'GERI_AL');
ALTER TABLE "planli_eylem" ADD CONSTRAINT "planli_uygulama_ciftli" CHECK (("durum" = 'UYGULANDI') = ("uygulamaZamani" IS NOT NULL));
ALTER TABLE "taksit_kalemi" ADD CONSTRAINT "taksit_odeme_ciftli" CHECK (("durum" = 'ODENDI') = ("odemeZamani" IS NOT NULL));
ALTER TABLE "taksit_kalemi" ADD CONSTRAINT "taksit_tutar_pozitif" CHECK ("tutar" > 0);
ALTER TABLE "kopya_uyarisi" ADD CONSTRAINT "kopya_kapanis_ciftli" CHECK (("durum" = 'KAPANDI') = ("kapanisZamani" IS NOT NULL));

-- Kurulum başına tür başına tek AÇIK kopya uyarısı · tek BEKLEYEN taşıma · tek aktif hak.
CREATE UNIQUE INDEX "kopya_uyarisi_acik_tekil" ON "kopya_uyarisi" ("kurulumId", "tur") WHERE "durum" = 'ACIK';
CREATE UNIQUE INDEX "tasima_talebi_bekleyen_tekil" ON "tasima_talebi" ("kurulumId") WHERE "durum" = 'BEKLIYOR';
CREATE UNIQUE INDEX "hak_aktif_tekil" ON "hak" ("kurulumId") WHERE "aktif";

-- =============================================================================
-- DEFTER DEĞİŞMEZ — hak_surumu · kira · yaptirim_eylemi · kurulum_kaydi satırı
-- güncellenemez ve silinemez. Tek istisna: adı `_test` ile biten DB'de, oturum
-- `satici.defter_temizlik = 'test'` beyan ettiğinde bekçi fikstürü silinebilir.
-- =============================================================================
CREATE FUNCTION "defter_degismez"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('satici.defter_temizlik', true) = 'test'
     AND current_database() LIKE '%\_test' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Defter satırı değiştirilemez ya da silinemez (%): geri alma ters kayıtla yapılır', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER "hak_surumu_defter" BEFORE UPDATE OR DELETE ON "hak_surumu" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
CREATE TRIGGER "kira_defter" BEFORE UPDATE OR DELETE ON "kira" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
CREATE TRIGGER "yaptirim_eylemi_defter" BEFORE UPDATE OR DELETE ON "yaptirim_eylemi" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
CREATE TRIGGER "kurulum_kaydi_defter" BEFORE UPDATE OR DELETE ON "kurulum_kaydi" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
