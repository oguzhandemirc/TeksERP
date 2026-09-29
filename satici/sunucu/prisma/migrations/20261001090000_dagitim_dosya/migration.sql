-- Dağıtım modülleri (Faz 3d-1): ilk kurulum bağlantısı · iki yönlü dosya paylaşımı · yayın bildirimi.
-- Yalnız EKLER (yeni tablo/enum); mevcut satırın anlamı değişmez. Belirteç düz metni DB'ye girmez.
-- CreateEnum
CREATE TYPE "IndirmeTuru" AS ENUM ('ILK_KURULUM', 'DOSYA');

-- CreateEnum
CREATE TYPE "BaglantiDurumu" AS ENUM ('AKTIF', 'IPTAL');

-- CreateEnum
CREATE TYPE "DosyaYonu" AS ENUM ('GIDEN', 'GELEN');

-- CreateEnum
CREATE TYPE "YuklemeDurumu" AS ENUM ('ACIK', 'TAMAMLANDI', 'TERK');

-- CreateTable
CREATE TABLE "dagitim_dosyasi" (
    "id" UUID NOT NULL,
    "musteriId" UUID NOT NULL,
    "yon" "DosyaYonu" NOT NULL,
    "ad" VARCHAR(200) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "boyut" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "depoAnahtari" VARCHAR(80) NOT NULL,
    "saklamaBitis" TIMESTAMPTZ NOT NULL,
    "govdeBudandiAt" TIMESTAMPTZ,
    "yuklemeIstegiId" UUID,
    "yukleyen" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dagitim_dosyasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indirme_baglantisi" (
    "id" UUID NOT NULL,
    "tur" "IndirmeTuru" NOT NULL,
    "musteriId" UUID NOT NULL,
    "kurulumId" UUID,
    "dosyaId" UUID,
    "derlemeAdi" VARCHAR(200),
    "derlemeSha256" CHAR(64),
    "derlemeBoyut" BIGINT,
    "belirtecOzeti" CHAR(64) NOT NULL,
    "belirtecSonu" VARCHAR(8) NOT NULL,
    "bitis" TIMESTAMPTZ NOT NULL,
    "azamiIndirme" INTEGER NOT NULL,
    "indirmeSayisi" INTEGER NOT NULL DEFAULT 0,
    "sonIndirme" TIMESTAMPTZ,
    "durum" "BaglantiDurumu" NOT NULL DEFAULT 'AKTIF',
    "aciklama" VARCHAR(500),
    "olusturan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "indirme_baglantisi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yukleme_istegi" (
    "id" UUID NOT NULL,
    "musteriId" UUID NOT NULL,
    "belirtecOzeti" CHAR(64) NOT NULL,
    "belirtecSonu" VARCHAR(8) NOT NULL,
    "bitis" TIMESTAMPTZ NOT NULL,
    "kotaBayt" BIGINT NOT NULL,
    "kullanilanBayt" BIGINT NOT NULL DEFAULT 0,
    "azamiDosyaBayt" BIGINT NOT NULL,
    "durum" "BaglantiDurumu" NOT NULL DEFAULT 'AKTIF',
    "aciklama" VARCHAR(500),
    "olusturan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "yukleme_istegi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yukleme_oturumu" (
    "id" UUID NOT NULL,
    "clientToken" UUID NOT NULL,
    "istekId" UUID,
    "musteriId" UUID NOT NULL,
    "yon" "DosyaYonu" NOT NULL,
    "dosyaAdi" VARCHAR(200) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "toplamBayt" BIGINT NOT NULL,
    "parcaBayt" INTEGER NOT NULL,
    "parcaSayisi" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "durum" "YuklemeDurumu" NOT NULL DEFAULT 'ACIK',
    "sonEtkinlik" TIMESTAMPTZ NOT NULL,
    "dosyaId" UUID,
    "olusturan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "yukleme_oturumu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yukleme_parcasi" (
    "id" UUID NOT NULL,
    "oturumId" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "bayt" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yukleme_parcasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dagitim_defteri" (
    "id" UUID NOT NULL,
    "olay" VARCHAR(40) NOT NULL,
    "musteriId" UUID NOT NULL,
    "baglantiId" UUID,
    "istekId" UUID,
    "dosyaId" UUID,
    "oturumId" UUID,
    "yapan" VARCHAR(120) NOT NULL,
    "ayrinti" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dagitim_defteri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yayinci_anahtari" (
    "id" UUID NOT NULL,
    "kid" VARCHAR(80) NOT NULL,
    "ad" VARCHAR(200) NOT NULL,
    "acikAnahtar" VARCHAR(64) NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "yayinci_anahtari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yayin_bildirimi" (
    "id" UUID NOT NULL,
    "bildirimKimligi" CHAR(64) NOT NULL,
    "olay" VARCHAR(20) NOT NULL,
    "urun" VARCHAR(20) NOT NULL,
    "kanalKodu" VARCHAR(40) NOT NULL,
    "surum" VARCHAR(40) NOT NULL,
    "yayinciKid" VARCHAR(80) NOT NULL,
    "olayZamani" TIMESTAMPTZ NOT NULL,
    "ayrinti" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yayin_bildirimi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dagitim_dosyasi_depoAnahtari_key" ON "dagitim_dosyasi"("depoAnahtari");

-- CreateIndex
CREATE INDEX "dagitim_dosyasi_musteriId_createdAt_idx" ON "dagitim_dosyasi"("musteriId", "createdAt");

-- CreateIndex
CREATE INDEX "dagitim_dosyasi_saklamaBitis_idx" ON "dagitim_dosyasi"("saklamaBitis");

-- CreateIndex
CREATE UNIQUE INDEX "indirme_baglantisi_belirtecOzeti_key" ON "indirme_baglantisi"("belirtecOzeti");

-- CreateIndex
CREATE INDEX "indirme_baglantisi_musteriId_createdAt_idx" ON "indirme_baglantisi"("musteriId", "createdAt");

-- CreateIndex
CREATE INDEX "indirme_baglantisi_kurulumId_idx" ON "indirme_baglantisi"("kurulumId");

-- CreateIndex
CREATE INDEX "indirme_baglantisi_dosyaId_idx" ON "indirme_baglantisi"("dosyaId");

-- CreateIndex
CREATE UNIQUE INDEX "yukleme_istegi_belirtecOzeti_key" ON "yukleme_istegi"("belirtecOzeti");

-- CreateIndex
CREATE INDEX "yukleme_istegi_musteriId_createdAt_idx" ON "yukleme_istegi"("musteriId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "yukleme_oturumu_clientToken_key" ON "yukleme_oturumu"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "yukleme_oturumu_dosyaId_key" ON "yukleme_oturumu"("dosyaId");

-- CreateIndex
CREATE INDEX "yukleme_oturumu_istekId_idx" ON "yukleme_oturumu"("istekId");

-- CreateIndex
CREATE INDEX "yukleme_oturumu_durum_sonEtkinlik_idx" ON "yukleme_oturumu"("durum", "sonEtkinlik");

-- CreateIndex
CREATE UNIQUE INDEX "yukleme_parcasi_oturumId_sira_key" ON "yukleme_parcasi"("oturumId", "sira");

-- CreateIndex
CREATE INDEX "dagitim_defteri_musteriId_createdAt_idx" ON "dagitim_defteri"("musteriId", "createdAt");

-- CreateIndex
CREATE INDEX "dagitim_defteri_baglantiId_idx" ON "dagitim_defteri"("baglantiId");

-- CreateIndex
CREATE INDEX "dagitim_defteri_istekId_idx" ON "dagitim_defteri"("istekId");

-- CreateIndex
CREATE INDEX "dagitim_defteri_dosyaId_idx" ON "dagitim_defteri"("dosyaId");

-- CreateIndex
CREATE UNIQUE INDEX "yayinci_anahtari_kid_key" ON "yayinci_anahtari"("kid");

-- CreateIndex
CREATE UNIQUE INDEX "yayin_bildirimi_bildirimKimligi_key" ON "yayin_bildirimi"("bildirimKimligi");

-- CreateIndex
CREATE INDEX "yayin_bildirimi_kanalKodu_createdAt_idx" ON "yayin_bildirimi"("kanalKodu", "createdAt");

-- AddForeignKey
ALTER TABLE "dagitim_dosyasi" ADD CONSTRAINT "dagitim_dosyasi_musteriId_fkey" FOREIGN KEY ("musteriId") REFERENCES "musteri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dagitim_dosyasi" ADD CONSTRAINT "dagitim_dosyasi_yuklemeIstegiId_fkey" FOREIGN KEY ("yuklemeIstegiId") REFERENCES "yukleme_istegi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indirme_baglantisi" ADD CONSTRAINT "indirme_baglantisi_musteriId_fkey" FOREIGN KEY ("musteriId") REFERENCES "musteri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indirme_baglantisi" ADD CONSTRAINT "indirme_baglantisi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indirme_baglantisi" ADD CONSTRAINT "indirme_baglantisi_dosyaId_fkey" FOREIGN KEY ("dosyaId") REFERENCES "dagitim_dosyasi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yukleme_istegi" ADD CONSTRAINT "yukleme_istegi_musteriId_fkey" FOREIGN KEY ("musteriId") REFERENCES "musteri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yukleme_oturumu" ADD CONSTRAINT "yukleme_oturumu_musteriId_fkey" FOREIGN KEY ("musteriId") REFERENCES "musteri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yukleme_oturumu" ADD CONSTRAINT "yukleme_oturumu_istekId_fkey" FOREIGN KEY ("istekId") REFERENCES "yukleme_istegi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yukleme_oturumu" ADD CONSTRAINT "yukleme_oturumu_dosyaId_fkey" FOREIGN KEY ("dosyaId") REFERENCES "dagitim_dosyasi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yukleme_parcasi" ADD CONSTRAINT "yukleme_parcasi_oturumId_fkey" FOREIGN KEY ("oturumId") REFERENCES "yukleme_oturumu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dagitim_defteri" ADD CONSTRAINT "dagitim_defteri_musteriId_fkey" FOREIGN KEY ("musteriId") REFERENCES "musteri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Çift yüklem ve sınırlar (sayaç ↔ durum; tür ↔ hedef).
ALTER TABLE "indirme_baglantisi" ADD CONSTRAINT "indirme_sayaci_sinirli" CHECK ("indirmeSayisi" >= 0 AND "indirmeSayisi" <= "azamiIndirme");
ALTER TABLE "indirme_baglantisi" ADD CONSTRAINT "indirme_azami_aralik" CHECK ("azamiIndirme" BETWEEN 1 AND 1000);
ALTER TABLE "indirme_baglantisi" ADD CONSTRAINT "indirme_tur_dosya" CHECK (("tur" = 'DOSYA') = ("dosyaId" IS NOT NULL));
ALTER TABLE "indirme_baglantisi" ADD CONSTRAINT "indirme_tur_derleme" CHECK (("tur" = 'ILK_KURULUM') = ("derlemeAdi" IS NOT NULL AND "derlemeSha256" IS NOT NULL AND "derlemeBoyut" IS NOT NULL));
ALTER TABLE "indirme_baglantisi" ADD CONSTRAINT "indirme_kurulum_yalniz_ilk" CHECK ("kurulumId" IS NULL OR "tur" = 'ILK_KURULUM');
ALTER TABLE "yukleme_istegi" ADD CONSTRAINT "yukleme_kotasi_sinirli" CHECK ("kullanilanBayt" >= 0 AND "kullanilanBayt" <= "kotaBayt");
ALTER TABLE "yukleme_istegi" ADD CONSTRAINT "yukleme_azami_dosya_pozitif" CHECK ("azamiDosyaBayt" > 0 AND "kotaBayt" > 0);
ALTER TABLE "yukleme_oturumu" ADD CONSTRAINT "oturum_tamam_dosyali" CHECK (("durum" = 'TAMAMLANDI') = ("dosyaId" IS NOT NULL));
ALTER TABLE "yukleme_oturumu" ADD CONSTRAINT "oturum_gelen_istekli" CHECK (("yon" = 'GELEN') = ("istekId" IS NOT NULL));
ALTER TABLE "yukleme_oturumu" ADD CONSTRAINT "oturum_parca_olculu" CHECK ("toplamBayt" > 0 AND "parcaBayt" > 0 AND "parcaSayisi" >= 1);
ALTER TABLE "yukleme_parcasi" ADD CONSTRAINT "parca_olculu" CHECK ("sira" >= 0 AND "bayt" > 0);
ALTER TABLE "dagitim_dosyasi" ADD CONSTRAINT "dosya_boyutu_pozitif" CHECK ("boyut" > 0);

-- Defterler değişmez (ilk_sema'daki `defter_degismez`; test temizliği yalnız `_test` DB'sinde beyanla).
CREATE TRIGGER "dagitim_defteri_defter" BEFORE UPDATE OR DELETE ON "dagitim_defteri" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
CREATE TRIGGER "yayin_bildirimi_defter" BEFORE UPDATE OR DELETE ON "yayin_bildirimi" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
