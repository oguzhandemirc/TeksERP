-- 3d-2: kurulum kaydı idempotency (fabrika kur.ps1 kaydı) + destek talepleri (durum tablosu + defter).

-- CreateEnum
CREATE TYPE "DestekDurumu" AS ENUM ('ACIK', 'YANITLANDI', 'KAPANDI');

-- CreateEnum
CREATE TYPE "DestekOlayTuru" AS ENUM ('ACILDI', 'YANIT', 'KAPATILDI');

-- AlterTable
ALTER TABLE "kurulum_kaydi" ADD COLUMN     "kaynakKayitId" UUID;

-- CreateTable
CREATE TABLE "destek_talebi" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "talepId" UUID NOT NULL,
    "talepNo" VARCHAR(40) NOT NULL,
    "konu" VARCHAR(200) NOT NULL,
    "aciklama" TEXT NOT NULL,
    "acan" VARCHAR(120),
    "panelSurum" VARCHAR(60),
    "ekTuru" VARCHAR(20),
    "ek" BYTEA,
    "saglik" JSONB NOT NULL,
    "ortam" JSONB NOT NULL,
    "durum" "DestekDurumu" NOT NULL DEFAULT 'ACIK',
    "kapanisZamani" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "destek_talebi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destek_olayi" (
    "id" UUID NOT NULL,
    "talepId" UUID NOT NULL,
    "tur" "DestekOlayTuru" NOT NULL,
    "metin" TEXT,
    "yapan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "destek_olayi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "destek_talebi_talepNo_key" ON "destek_talebi"("talepNo");

-- CreateIndex
CREATE INDEX "destek_talebi_durum_updatedAt_idx" ON "destek_talebi"("durum", "updatedAt");

-- CreateIndex
CREATE INDEX "destek_talebi_kurulumId_updatedAt_idx" ON "destek_talebi"("kurulumId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "destek_talebi_kurulumId_talepId_key" ON "destek_talebi"("kurulumId", "talepId");

-- CreateIndex
CREATE INDEX "destek_olayi_talepId_createdAt_idx" ON "destek_olayi"("talepId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "kurulum_kaydi_kurulumId_kaynakKayitId_key" ON "kurulum_kaydi"("kurulumId", "kaynakKayitId");

-- AddForeignKey
ALTER TABLE "destek_talebi" ADD CONSTRAINT "destek_talebi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destek_olayi" ADD CONSTRAINT "destek_olayi_talepId_fkey" FOREIGN KEY ("talepId") REFERENCES "destek_talebi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Talep numarası sırası: numara doğuşta `DST-` + 6 hane olarak materyalize edilir.
CREATE SEQUENCE "destek_talep_no_seq" START 1;

-- Destek defteri değişmez (diğer defterlerle aynı işlev).
CREATE TRIGGER "destek_olayi_defter" BEFORE UPDATE OR DELETE ON "destek_olayi" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
