-- Geçici açılış kodu (yazarak etkinleştirme): kökle imzalanan kodların doğum kaydı + bayi talebi.
-- CreateEnum
CREATE TYPE "GeciciKodTalebiDurumu" AS ENUM ('BEKLIYOR', 'URETILDI', 'REDDEDILDI');

-- CreateTable
CREATE TABLE "gecici_acilis_kodlari" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "kodNo" INTEGER NOT NULL,
    "istekKodu" VARCHAR(24) NOT NULL,
    "anahtarOzeti" VARCHAR(16) NOT NULL,
    "gun" INTEGER NOT NULL,
    "bitisGunu" INTEGER NOT NULL,
    "bitis" TIMESTAMPTZ NOT NULL,
    "imzalayanKid" VARCHAR(64) NOT NULL,
    "ozet" VARCHAR(64) NOT NULL,
    "kodSonu" VARCHAR(4) NOT NULL,
    "sariliKod" VARCHAR(400),
    "talepId" UUID,
    "sebep" VARCHAR(500) NOT NULL,
    "ureten" VARCHAR(120) NOT NULL,
    "tuketildiAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gecici_acilis_kodlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gecici_kod_talebi" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "bayiId" UUID NOT NULL,
    "istekKodu" VARCHAR(24) NOT NULL,
    "anahtarOzeti" VARCHAR(16) NOT NULL,
    "gun" INTEGER NOT NULL,
    "sebep" VARCHAR(500) NOT NULL,
    "yapan" VARCHAR(120) NOT NULL,
    "durum" "GeciciKodTalebiDurumu" NOT NULL DEFAULT 'BEKLIYOR',
    "kapanisZamani" TIMESTAMPTZ,
    "kapatan" VARCHAR(120),
    "kapanisSebebi" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gecici_kod_talebi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gecici_acilis_kodlari_kodNo_key" ON "gecici_acilis_kodlari"("kodNo");

-- CreateIndex
CREATE UNIQUE INDEX "gecici_acilis_kodlari_ozet_key" ON "gecici_acilis_kodlari"("ozet");

-- CreateIndex
CREATE UNIQUE INDEX "gecici_acilis_kodlari_talepId_key" ON "gecici_acilis_kodlari"("talepId");

-- CreateIndex
CREATE INDEX "gecici_acilis_kodlari_kurulumId_createdAt_idx" ON "gecici_acilis_kodlari"("kurulumId", "createdAt");

-- CreateIndex
CREATE INDEX "gecici_acilis_kodlari_anahtarOzeti_idx" ON "gecici_acilis_kodlari"("anahtarOzeti");

-- CreateIndex
CREATE INDEX "gecici_kod_talebi_durum_createdAt_idx" ON "gecici_kod_talebi"("durum", "createdAt");

-- CreateIndex
CREATE INDEX "gecici_kod_talebi_kurulumId_idx" ON "gecici_kod_talebi"("kurulumId");

-- CreateIndex
CREATE INDEX "gecici_kod_talebi_bayiId_idx" ON "gecici_kod_talebi"("bayiId");

-- AddForeignKey
ALTER TABLE "gecici_acilis_kodlari" ADD CONSTRAINT "gecici_acilis_kodlari_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gecici_acilis_kodlari" ADD CONSTRAINT "gecici_acilis_kodlari_talepId_fkey" FOREIGN KEY ("talepId") REFERENCES "gecici_kod_talebi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gecici_kod_talebi" ADD CONSTRAINT "gecici_kod_talebi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gecici_kod_talebi" ADD CONSTRAINT "gecici_kod_talebi_bayiId_fkey" FOREIGN KEY ("bayiId") REFERENCES "bayi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Gün aralığı protokolün `TEMP_CODE_DAYS`ı; kod kimliği koda 24 bitle gömülür.
ALTER TABLE "gecici_acilis_kodlari" ADD CONSTRAINT "gecici_acilis_kodlari_gun_check" CHECK ("gun" BETWEEN 7 AND 90);
ALTER TABLE "gecici_acilis_kodlari" ADD CONSTRAINT "gecici_acilis_kodlari_kodNo_check" CHECK ("kodNo" BETWEEN 1 AND 16777215);
ALTER TABLE "gecici_kod_talebi" ADD CONSTRAINT "gecici_kod_talebi_gun_check" CHECK ("gun" BETWEEN 7 AND 90);
-- Kapanmış talebin kapanış alanları dolu, bekleyeninki boş.
ALTER TABLE "gecici_kod_talebi" ADD CONSTRAINT "gecici_kod_talebi_kapanis_check"
  CHECK (("durum" = 'BEKLIYOR') = ("kapanisZamani" IS NULL AND "kapatan" IS NULL));
CREATE SEQUENCE "gecici_acilis_kodu_no_seq" MINVALUE 1 MAXVALUE 16777215 NO CYCLE;

-- Kod satırı ve talep SİLİNMEZ (yalnız `_test` DB'sinde beyanlı bekçi temizliği).
CREATE TRIGGER "gecici_acilis_kodlari_silinmez" BEFORE DELETE ON "gecici_acilis_kodlari" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
CREATE TRIGGER "gecici_kod_talebi_silinmez" BEFORE DELETE ON "gecici_kod_talebi" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
