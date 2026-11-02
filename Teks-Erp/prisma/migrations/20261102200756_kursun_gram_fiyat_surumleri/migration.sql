-- Kurşun gram fiyatı SÜRÜMLERİ (K14, kullanıcı kararı 2026-11-02): fatura işin anındaki gram fiyatını okur.
-- Append-only (updatedAt yok); kolonlar ("şu an ne") yerinde kalır. Mevcut dolu fiyatlar için migration
-- anında BİRER başlangıç sürümü doğar — daha eski işler "en eski sürüm + uyarı" kuralıyla fiyatlanır.

-- CreateTable
CREATE TABLE "kursun_gram_price_versions" (
    "id" UUID NOT NULL,
    "stationId" UUID,
    "cariAccountId" UUID,
    "price" DECIMAL(12,4),
    "currency" "Currency",
    "validFrom" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kursun_gram_price_versions_pkey" PRIMARY KEY ("id")
);
-- Sahip tam biri; fiyat >= 0; fiyat ve para birimi birlikte (kaldırma sürümünde ikisi de NULL).
ALTER TABLE "kursun_gram_price_versions" ADD CONSTRAINT "kursun_gram_price_versions_owner_ck"
  CHECK (("stationId" IS NULL) <> ("cariAccountId" IS NULL));
ALTER TABLE "kursun_gram_price_versions" ADD CONSTRAINT "kursun_gram_price_versions_price_ck"
  CHECK (("price" IS NULL) = ("currency" IS NULL) AND ("price" IS NULL OR "price" >= 0));

-- CreateIndex
CREATE INDEX "kursun_gram_price_versions_stationId_validFrom_idx" ON "kursun_gram_price_versions"("stationId", "validFrom");

-- CreateIndex
CREATE INDEX "kursun_gram_price_versions_cariAccountId_validFrom_idx" ON "kursun_gram_price_versions"("cariAccountId", "validFrom");

-- AddForeignKey
ALTER TABLE "kursun_gram_price_versions" ADD CONSTRAINT "kursun_gram_price_versions_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kursun_gram_price_versions" ADD CONSTRAINT "kursun_gram_price_versions_cariAccountId_fkey" FOREIGN KEY ("cariAccountId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Başlangıç sürümleri (idempotent: sürümü olan sahip atlanır).
INSERT INTO "kursun_gram_price_versions" ("id", "stationId", "price", "currency", "validFrom")
SELECT gen_random_uuid(), s."id", s."kursunGramPrice", s."kursunGramCurrency", now()
FROM "stations" s
WHERE s."kursunGramPrice" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "kursun_gram_price_versions" v WHERE v."stationId" = s."id");

INSERT INTO "kursun_gram_price_versions" ("id", "cariAccountId", "price", "currency", "validFrom")
SELECT gen_random_uuid(), c."id", c."kursunGramPrice", c."kursunGramCurrency", now()
FROM "cari_accounts" c
WHERE c."kursunGramPrice" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "kursun_gram_price_versions" v WHERE v."cariAccountId" = c."id");
