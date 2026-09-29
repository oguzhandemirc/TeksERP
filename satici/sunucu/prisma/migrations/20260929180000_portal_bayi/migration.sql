-- CreateEnum
CREATE TYPE "PortalRolu" AS ENUM ('SATICI_YONETICI', 'SATICI_OPERATOR', 'BAYI');

-- CreateEnum
CREATE TYPE "PortalDinleyici" AS ENUM ('GENEL', 'TAILNET');

-- AlterTable
ALTER TABLE "musteri" ADD COLUMN     "bayiId" UUID;

-- AlterTable
ALTER TABLE "planli_eylem" ADD COLUMN     "iptalEden" VARCHAR(120),
ADD COLUMN     "iptalSebebi" VARCHAR(500),
ADD COLUMN     "iptalZamani" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "taksit_plani" ADD COLUMN     "kapanisSebebi" VARCHAR(500),
ADD COLUMN     "kapanisZamani" TIMESTAMPTZ,
ADD COLUMN     "kapatan" VARCHAR(120);

-- CreateTable
CREATE TABLE "bayi" (
    "id" UUID NOT NULL,
    "ad" VARCHAR(200) NOT NULL,
    "vergiNo" VARCHAR(20),
    "anahtarKid" VARCHAR(80),
    "guncelTavanSurum" INTEGER NOT NULL DEFAULT 0,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bayi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bayi_tavani" (
    "id" UUID NOT NULL,
    "bayiId" UUID NOT NULL,
    "surum" INTEGER NOT NULL,
    "moduller" TEXT[],
    "siniflar" "LisansSinifi"[],
    "kurulumAdedi" INTEGER NOT NULL,
    "sebep" VARCHAR(500) NOT NULL,
    "yapan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bayi_tavani_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_kullanici" (
    "id" UUID NOT NULL,
    "kullaniciAdi" VARCHAR(60) NOT NULL,
    "adSoyad" VARCHAR(120) NOT NULL,
    "rol" "PortalRolu" NOT NULL,
    "bayiId" UUID,
    "parolaOzeti" VARCHAR(200) NOT NULL,
    "totpSirSifreli" VARCHAR(200) NOT NULL,
    "totpSonAdim" INTEGER,
    "basarisizGiris" INTEGER NOT NULL DEFAULT 0,
    "kilitBitis" TIMESTAMPTZ,
    "sonGiris" TIMESTAMPTZ,
    "parolaDegisim" TIMESTAMPTZ NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "portal_kullanici_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_oturumu" (
    "id" UUID NOT NULL,
    "kullaniciId" UUID NOT NULL,
    "belirtecOzeti" VARCHAR(64) NOT NULL,
    "dinleyici" "PortalDinleyici" NOT NULL,
    "sonKullanim" TIMESTAMPTZ NOT NULL,
    "bitis" TIMESTAMPTZ NOT NULL,
    "kapanisZamani" TIMESTAMPTZ,
    "kapanisNedeni" VARCHAR(40),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "portal_oturumu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_islemi" (
    "id" UUID NOT NULL,
    "clientToken" UUID NOT NULL,
    "kullaniciId" UUID NOT NULL,
    "eylem" VARCHAR(60) NOT NULL,
    "govdeOzeti" VARCHAR(64) NOT NULL,
    "yanitDurumu" INTEGER NOT NULL,
    "yanit" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_islemi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bayi_anahtarKid_key" ON "bayi"("anahtarKid");

-- CreateIndex
CREATE UNIQUE INDEX "bayi_tavani_bayiId_surum_key" ON "bayi_tavani"("bayiId", "surum");

-- CreateIndex
CREATE UNIQUE INDEX "portal_kullanici_kullaniciAdi_key" ON "portal_kullanici"("kullaniciAdi");

-- CreateIndex
CREATE UNIQUE INDEX "portal_oturumu_belirtecOzeti_key" ON "portal_oturumu"("belirtecOzeti");

-- CreateIndex
CREATE INDEX "portal_oturumu_kullaniciId_idx" ON "portal_oturumu"("kullaniciId");

-- CreateIndex
CREATE INDEX "portal_oturumu_bitis_idx" ON "portal_oturumu"("bitis");

-- CreateIndex
CREATE UNIQUE INDEX "portal_islemi_clientToken_key" ON "portal_islemi"("clientToken");

-- CreateIndex
CREATE INDEX "portal_islemi_createdAt_idx" ON "portal_islemi"("createdAt");

-- CreateIndex
CREATE INDEX "musteri_bayiId_idx" ON "musteri"("bayiId");

-- AddForeignKey
ALTER TABLE "musteri" ADD CONSTRAINT "musteri_bayiId_fkey" FOREIGN KEY ("bayiId") REFERENCES "bayi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bayi_tavani" ADD CONSTRAINT "bayi_tavani_bayiId_fkey" FOREIGN KEY ("bayiId") REFERENCES "bayi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_kullanici" ADD CONSTRAINT "portal_kullanici_bayiId_fkey" FOREIGN KEY ("bayiId") REFERENCES "bayi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_oturumu" ADD CONSTRAINT "portal_oturumu_kullaniciId_fkey" FOREIGN KEY ("kullaniciId") REFERENCES "portal_kullanici"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- DB SEDDİ — portal ve bayi (çift yüklem: durum ↔ damga)
-- =============================================================================
-- Mevcut satırların geriye uyumu: CHECK'ten ÖNCE eski IPTAL/pasif satırlara damga (iptal/kapanış anı
-- bilinmiyor → son güncelleme anı; yapan/sebep "göç" beyanıyla).
UPDATE "planli_eylem" SET "iptalZamani" = "updatedAt", "iptalEden" = 'goc', "iptalSebebi" = 'göç: iptal anı bilinmiyor'
  WHERE "durum" = 'IPTAL' AND "iptalZamani" IS NULL;
UPDATE "taksit_plani" SET "kapanisZamani" = "updatedAt", "kapatan" = 'goc', "kapanisSebebi" = 'göç: kapanış anı bilinmiyor'
  WHERE NOT "aktif" AND "kapanisZamani" IS NULL;

ALTER TABLE "planli_eylem" ADD CONSTRAINT "planli_iptal_ciftli"
  CHECK (("durum" = 'IPTAL') = ("iptalZamani" IS NOT NULL AND "iptalEden" IS NOT NULL AND "iptalSebebi" IS NOT NULL));
ALTER TABLE "taksit_plani" ADD CONSTRAINT "taksit_plani_kapanis_ciftli"
  CHECK ((NOT "aktif") = ("kapanisZamani" IS NOT NULL AND "kapatan" IS NOT NULL));
ALTER TABLE "bayi" ADD CONSTRAINT "bayi_tavan_surum_negatif_degil" CHECK ("guncelTavanSurum" >= 0);
ALTER TABLE "bayi_tavani" ADD CONSTRAINT "bayi_tavani_surum_pozitif" CHECK ("surum" >= 1);
ALTER TABLE "bayi_tavani" ADD CONSTRAINT "bayi_tavani_adet_negatif_degil" CHECK ("kurulumAdedi" >= 0);
ALTER TABLE "bayi_tavani" ADD CONSTRAINT "bayi_tavani_sebep_dolu" CHECK (length(btrim("sebep")) > 0);
-- Bayi hesabı yalnız bir bayiye bağlı doğar; satıcı rolleri bayiye bağlanamaz.
ALTER TABLE "portal_kullanici" ADD CONSTRAINT "portal_kullanici_bayi_ciftli" CHECK (("rol" = 'BAYI') = ("bayiId" IS NOT NULL));
ALTER TABLE "portal_kullanici" ADD CONSTRAINT "portal_kullanici_ad_bicimi" CHECK ("kullaniciAdi" ~ '^[a-z0-9][a-z0-9._-]{2,59}$');
ALTER TABLE "portal_kullanici" ADD CONSTRAINT "portal_kullanici_sayac" CHECK ("basarisizGiris" >= 0);
ALTER TABLE "portal_oturumu" ADD CONSTRAINT "portal_oturumu_kapanis_ciftli" CHECK (("kapanisZamani" IS NULL) = ("kapanisNedeni" IS NULL));
ALTER TABLE "portal_oturumu" ADD CONSTRAINT "portal_oturumu_bitis_sonra" CHECK ("bitis" > "createdAt");

-- Bayi tavanı DEFTERDİR: satır değişmez, silinmez (tavan değişimi yeni sürüm satırıdır).
CREATE TRIGGER "bayi_tavani_defter" BEFORE UPDATE OR DELETE ON "bayi_tavani" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
