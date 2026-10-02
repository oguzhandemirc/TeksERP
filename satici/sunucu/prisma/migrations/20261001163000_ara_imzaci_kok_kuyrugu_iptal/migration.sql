-- =============================================================================
-- Lisans v2 · L2-3 (G4): HAK ara imzacısı · kök imzası bekleyen HAK kuyruğu · sertifika iptal defteri ·
-- HAK çevrimdışı ufku ve kip alt sınırı (K2). YALNIZ EKLER: var olan satırların anlamı değişmez
-- (yeni kolonların varsayılanı bugünkü davranış: ufuk alanı yok, kip alt sınırı yok, uzun ufuk yok).
-- =============================================================================

-- AnahtarTuru: HAK ara imzacısı (anahtar künyesi).
ALTER TYPE "AnahtarTuru" ADD VALUE 'ARA';

CREATE TYPE "HakKokTalebiDurumu" AS ENUM ('BEKLIYOR', 'IMZALANDI', 'IPTAL', 'ESKIDI');

-- HAK: çevrimdışı ufuk (gün ya da süresiz) + kip alt sınırı. NULL + false = v1 HAK (alan basılmadı).
ALTER TABLE "hak" ADD COLUMN     "cevrimdisiUfukGun" INTEGER,
ADD COLUMN     "cevrimdisiUfukSuresiz" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kipAltSiniriZorla" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hak" ADD CONSTRAINT "hak_ufuk_gun_araligi" CHECK ("cevrimdisiUfukGun" IS NULL OR "cevrimdisiUfukGun" BETWEEN 1 AND 3650);
ALTER TABLE "hak" ADD CONSTRAINT "hak_ufuk_tek_bicim" CHECK (NOT ("cevrimdisiUfukSuresiz" AND "cevrimdisiUfukGun" IS NOT NULL));

-- HAK sürüm defteri: uzun ufuk işareti (K2). Sabit varsayılanlı kolon ekleme satırları güncellemez (tetikleyici koşmaz).
ALTER TABLE "hak_surumu" ADD COLUMN     "uzunUfuk" BOOLEAN NOT NULL DEFAULT false;

-- Kök imzası bekleyen HAK sürümleri (durum tablosu).
CREATE TABLE "hak_kok_talebi" (
    "id" UUID NOT NULL,
    "hakId" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "tabanSurum" INTEGER NOT NULL,
    "surum" INTEGER NOT NULL,
    "yuk" JSONB NOT NULL,
    "uzunUfuk" BOOLEAN NOT NULL DEFAULT false,
    "durum" "HakKokTalebiDurumu" NOT NULL DEFAULT 'BEKLIYOR',
    "sebep" VARCHAR(500) NOT NULL,
    "yapan" VARCHAR(120) NOT NULL,
    "kapanisZamani" TIMESTAMPTZ,
    "kapatan" VARCHAR(120),
    "kapanisSebebi" VARCHAR(500),
    "hakSurumuId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hak_kok_talebi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hak_kok_talebi_surum" CHECK ("tabanSurum" >= 0 AND "surum" = "tabanSurum" + 1),
    -- Durum ↔ kapanış kolonları çift yüklemi: açık talep kapanış taşımaz; kapanan taşır; yalnız IMZALANDI defter satırına bağlıdır.
    CONSTRAINT "hak_kok_talebi_kapanis" CHECK (
      ("durum" = 'BEKLIYOR' AND "kapanisZamani" IS NULL AND "hakSurumuId" IS NULL)
      OR ("durum" = 'IMZALANDI' AND "kapanisZamani" IS NOT NULL AND "hakSurumuId" IS NOT NULL)
      OR ("durum" IN ('IPTAL', 'ESKIDI') AND "kapanisZamani" IS NOT NULL AND "hakSurumuId" IS NULL)
    )
);

CREATE INDEX "hak_kok_talebi_durum_createdAt_idx" ON "hak_kok_talebi"("durum", "createdAt");
CREATE INDEX "hak_kok_talebi_hakId_idx" ON "hak_kok_talebi"("hakId");
CREATE INDEX "hak_kok_talebi_kurulumId_idx" ON "hak_kok_talebi"("kurulumId");
-- HAK başına en çok bir bekleyen talep.
CREATE UNIQUE INDEX "hak_kok_talebi_bekleyen_tekil" ON "hak_kok_talebi" ("hakId") WHERE "durum" = 'BEKLIYOR';

ALTER TABLE "hak_kok_talebi" ADD CONSTRAINT "hak_kok_talebi_hakId_fkey" FOREIGN KEY ("hakId") REFERENCES "hak"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hak_kok_talebi" ADD CONSTRAINT "hak_kok_talebi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hak_kok_talebi" ADD CONSTRAINT "hak_kok_talebi_hakSurumuId_fkey" FOREIGN KEY ("hakSurumuId") REFERENCES "hak_surumu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sertifika iptal belgeleri — EKLEME-YALNIZ defter (geri alma daha yüksek sıralı yeni belgedir).
CREATE TABLE "iptal_belgesi" (
    "id" UUID NOT NULL,
    "iptalId" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "belge" TEXT NOT NULL,
    "imzalayanKid" VARCHAR(64) NOT NULL,
    "verilis" TIMESTAMPTZ NOT NULL,
    "kidler" TEXT[],
    "yukleyen" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iptal_belgesi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "iptal_belgesi_sira_pozitif" CHECK ("sira" >= 1)
);

CREATE UNIQUE INDEX "iptal_belgesi_iptalId_key" ON "iptal_belgesi"("iptalId");
CREATE UNIQUE INDEX "iptal_belgesi_sira_key" ON "iptal_belgesi"("sira");

CREATE TRIGGER "iptal_belgesi_defter" BEFORE UPDATE OR DELETE ON "iptal_belgesi" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
