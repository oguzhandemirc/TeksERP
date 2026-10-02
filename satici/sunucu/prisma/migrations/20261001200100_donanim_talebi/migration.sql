-- Lisans v2 · L2-11 (parmak izi K8) — YALNIZ EKLER (yeni tür · tablo · kolon; mevcut satırların anlamı değişmez).
--   donanim_talebi            — donanım değişikliği bildirimi / zayıf tanıma onay talebi (durum makinesi, atomik claim)
--   kurulum.sonKayipEtkenler  — zincir sahibinin son yoklamasının kayıp etkenleri (portala not, durum kolonu)
CREATE TYPE "DonanimTalebiTuru" AS ENUM ('DONANIM', 'ZAYIF_TANIMA');
CREATE TYPE "DonanimTalebiDurumu" AS ENUM ('BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI');

ALTER TABLE "kurulum" ADD COLUMN IF NOT EXISTS "sonKayipEtkenler" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "donanim_talebi" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "tur" "DonanimTalebiTuru" NOT NULL,
    "durum" "DonanimTalebiDurumu" NOT NULL DEFAULT 'BEKLIYOR',
    "anahtarKimligi" VARCHAR(64) NOT NULL,
    "parmakIzi" JSONB NOT NULL,
    "kabulEdilen" JSONB,
    "kayip" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "gerekce" VARCHAR(500),
    "otomatik" BOOLEAN NOT NULL DEFAULT false,
    "bildirimSayisi" INTEGER NOT NULL DEFAULT 1,
    "sonBildirim" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kararZamani" TIMESTAMPTZ,
    "kararVeren" VARCHAR(120),
    "kararSebebi" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "donanim_talebi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "donanim_talebi_durum_createdAt_idx" ON "donanim_talebi"("durum", "createdAt");
CREATE INDEX "donanim_talebi_kurulumId_idx" ON "donanim_talebi"("kurulumId");

ALTER TABLE "donanim_talebi" ADD CONSTRAINT "donanim_talebi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Karar üçlüsü durumla birlikte: bekleyen talepte karar yok; karara bağlanan talepte zaman + veren + SEBEP zorunlu.
ALTER TABLE "donanim_talebi" ADD CONSTRAINT "donanim_talebi_karar_ciftli" CHECK (
  ("durum" = 'BEKLIYOR') = ("kararZamani" IS NULL)
  AND ("durum" = 'BEKLIYOR' OR ("kararVeren" IS NOT NULL AND "kararSebebi" IS NOT NULL AND length(btrim("kararSebebi")) > 0))
);
-- Otomatik öğrenme yalnız donanım bildiriminde ve yalnız ONAYLANDI doğar (zayıf tanıma daima insan onayı ister).
ALTER TABLE "donanim_talebi" ADD CONSTRAINT "donanim_talebi_otomatik" CHECK (NOT "otomatik" OR ("tur" = 'DONANIM' AND "durum" = 'ONAYLANDI'));
ALTER TABLE "donanim_talebi" ADD CONSTRAINT "donanim_talebi_bildirim_sayisi" CHECK ("bildirimSayisi" >= 1);
ALTER TABLE "donanim_talebi" ADD CONSTRAINT "donanim_talebi_kayip_etken" CHECK ("kayip" <@ ARRAY['f1', 'f2', 'f3', 'f4', 'f5']::TEXT[]);

-- Bekleyen talep (kurulum · tür · anahtar) başına TEK — eşzamanlı iki bildirim ikinci satırı UNIQUE ile düşer.
CREATE UNIQUE INDEX "donanim_talebi_bekleyen_tekil" ON "donanim_talebi" ("kurulumId", "tur", "anahtarKimligi") WHERE "durum" = 'BEKLIYOR';
