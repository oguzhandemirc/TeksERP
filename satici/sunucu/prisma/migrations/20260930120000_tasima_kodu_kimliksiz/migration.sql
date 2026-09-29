-- Satıcı düzeltmeleri (F2): kod türü + taşıma kodu (D8) · kimliksiz taşıma talebi ve kurulumsuz
-- nonce kapsamı (D14) · iki yeni kopya uyarısı türü (D2s) · imza parolası sayacı (D11). Yalnız EKLER
-- ya da gevşetir (NOT NULL → NULL); mevcut satırın anlamı değişmez.

-- CreateEnum
CREATE TYPE "KodTuru" AS ENUM ('ilk', 'tasima');

-- AlterEnum (PG ≥ 12: aynı tx'te kullanılmadıkça ADD VALUE tx içinde geçerli)
ALTER TYPE "KopyaUyariTuru" ADD VALUE 'YABANCI_KIRA';
ALTER TYPE "KopyaUyariTuru" ADD VALUE 'KIP_UYUSMAZ';

-- Etkinleştirme kodu: tür (mevcut satırlar `ilk`) + taşıma kodunun talebi.
ALTER TABLE "etkinlestirme_kodu" ADD COLUMN     "tasimaTalebiId" UUID,
ADD COLUMN     "tur" "KodTuru" NOT NULL DEFAULT 'ilk';
CREATE UNIQUE INDEX "etkinlestirme_kodu_tasimaTalebiId_key" ON "etkinlestirme_kodu"("tasimaTalebiId");
ALTER TABLE "etkinlestirme_kodu" ADD CONSTRAINT "etkinlestirme_kodu_tasimaTalebiId_fkey" FOREIGN KEY ("tasimaTalebiId") REFERENCES "tasima_talebi"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
-- Çift yüklem: taşıma kodu ⇔ talebi var.
ALTER TABLE "etkinlestirme_kodu" ADD CONSTRAINT "kod_tasima_talepli" CHECK (("tur" = 'tasima') = ("tasimaTalebiId" IS NOT NULL));

-- Nonce kapsamı: kurulumun satıcı kimliği ya da (kurulumsuz taşıma talebinde) `kid:<anahtar>`.
ALTER TABLE "nonce_defteri" ADD COLUMN "kapsam" VARCHAR(80);
UPDATE "nonce_defteri" SET "kapsam" = "kurulumId"::text WHERE "kapsam" IS NULL;
ALTER TABLE "nonce_defteri" ALTER COLUMN "kapsam" SET NOT NULL;
ALTER TABLE "nonce_defteri" ALTER COLUMN "kurulumId" DROP NOT NULL;
DROP INDEX "nonce_defteri_kurulumId_nonce_key";
CREATE UNIQUE INDEX "nonce_defteri_kapsam_nonce_key" ON "nonce_defteri"("kapsam", "nonce");
CREATE INDEX "nonce_defteri_kurulumId_idx" ON "nonce_defteri"("kurulumId");
-- Kapsam kurulumu gösteriyorsa kurulum kimliğiyle aynıdır; kurulumsuz satır yalnız anahtar kapsamında.
ALTER TABLE "nonce_defteri" ADD CONSTRAINT "nonce_kapsam_tutarli"
  CHECK (("kurulumId" IS NULL AND "kapsam" LIKE 'kid:%') OR ("kurulumId" IS NOT NULL AND "kapsam" = "kurulumId"::text));

-- İmza parolası (kök/bayi) ardışık hata sayacı ve süreli kilidi (giriş kilidinden ayrı).
ALTER TABLE "portal_kullanici" ADD COLUMN     "imzaBasarisiz" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "imzaKilitBitis" TIMESTAMPTZ;
ALTER TABLE "portal_kullanici" ADD CONSTRAINT "imza_basarisiz_negatif_degil" CHECK ("imzaBasarisiz" >= 0);

-- Kimliksiz taşıma talebi kuruluma BAĞSIZ doğar; bağı onaylayan operatör kurar.
ALTER TABLE "tasima_talebi" ALTER COLUMN "kurulumId" DROP NOT NULL;
CREATE INDEX "tasima_talebi_yeniAnahtarKimligi_idx" ON "tasima_talebi"("yeniAnahtarKimligi");
-- Onaylanan talep daima bir kuruluma bağlıdır; bağsız bekleyen talep anahtar başına tek.
ALTER TABLE "tasima_talebi" ADD CONSTRAINT "tasima_onayli_bagli" CHECK ("durum" <> 'ONAYLANDI' OR "kurulumId" IS NOT NULL);
CREATE UNIQUE INDEX "tasima_talebi_bagsiz_bekleyen_tekil" ON "tasima_talebi" ("yeniAnahtarKimligi") WHERE "kurulumId" IS NULL AND "durum" = 'BEKLIYOR';
