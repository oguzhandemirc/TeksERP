-- Kanal varlığı (kurulum kanala bağlanır; kira kanal.guncelSurumler'i buradan alır) + bayi tavanına
-- kanallar · kaliciIzni (yönetici kararı g; varsayılan hayır) · bakimAyTavani. Yalnız EKLER.

-- CreateEnum
CREATE TYPE "KanalTuru" AS ENUM ('uretim', 'hazirlik');

-- AlterTable (bayi_tavani defterdir: ADD COLUMN satır güncellemez, tetikleyici koşmaz)
ALTER TABLE "bayi_tavani" ADD COLUMN     "bakimAyTavani" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "kaliciIzni" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kanallar" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "kanal" (
    "id" UUID NOT NULL,
    "kod" VARCHAR(40) NOT NULL,
    "ad" VARCHAR(200) NOT NULL,
    "tur" "KanalTuru" NOT NULL,
    "guncelSurumler" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kanal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kanal_kod_key" ON "kanal"("kod");

-- CreateIndex
CREATE INDEX "kurulum_kanalKodu_idx" ON "kurulum"("kanalKodu");

-- Geriye uyum: FK'dan ÖNCE mevcut kurulumların kanal kodlarına kanal satırı (ad = kod; tür portalda düzeltilir).
INSERT INTO "kanal" ("id", "kod", "ad", "tur", "guncelSurumler", "createdAt", "updatedAt")
SELECT gen_random_uuid(), k."kanalKodu", k."kanalKodu", 'uretim', '{}'::jsonb, now(), now()
FROM (SELECT DISTINCT "kanalKodu" FROM "kurulum") k
ON CONFLICT ("kod") DO NOTHING;

-- AddForeignKey
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_kanalKodu_fkey" FOREIGN KEY ("kanalKodu") REFERENCES "kanal"("kod") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Seddler
ALTER TABLE "kanal" ADD CONSTRAINT "kanal_kod_bicimi" CHECK ("kod" ~ '^[a-z0-9][a-z0-9-]{0,39}$');
ALTER TABLE "kanal" ADD CONSTRAINT "kanal_surumler_nesne" CHECK (jsonb_typeof("guncelSurumler") = 'object');
ALTER TABLE "bayi_tavani" ADD CONSTRAINT "bayi_tavani_bakim_ay" CHECK ("bakimAyTavani" BETWEEN 1 AND 120);
