-- Kurşun gramajı sayısı + tek varsayılan + gram fiyatı (oie-a, 2026-11-02).
-- Hepsi NULL/false varsayılanlı: mevcut kurulumda davranış değişmez (fiyat yoksa hizmet kalemi fiyatı).

-- AlterTable
ALTER TABLE "cari_accounts" ADD COLUMN     "kursunGramCurrency" "Currency",
ADD COLUMN     "kursunGramPrice" DECIMAL(12,4);
ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_kursun_gram_price_ck"
  CHECK (("kursunGramPrice" IS NULL) = ("kursunGramCurrency" IS NULL) AND ("kursunGramPrice" IS NULL OR "kursunGramPrice" >= 0));

-- AlterTable
ALTER TABLE "fabric_property_values" ADD COLUMN     "amount" DECIMAL(10,3),
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fabric_property_values" ADD CONSTRAINT "fabric_property_values_amount_ck"
  CHECK ("amount" IS NULL OR "amount" > 0);
-- Çeşit başına TEK varsayılan (kurşun istasyonu gramaj tablosu); pasif değer varsayılan olamaz.
CREATE UNIQUE INDEX "fabric_property_values_default_uq" ON "fabric_property_values" ("propertyId") WHERE "isDefault";
ALTER TABLE "fabric_property_values" ADD CONSTRAINT "fabric_property_values_default_active_ck"
  CHECK (NOT "isDefault" OR "isActive");

-- AlterTable
ALTER TABLE "stations" ADD COLUMN     "kursunGramCurrency" "Currency",
ADD COLUMN     "kursunGramPrice" DECIMAL(12,4);
ALTER TABLE "stations" ADD CONSTRAINT "stations_kursun_gram_price_ck"
  CHECK (("kursunGramPrice" IS NULL) = ("kursunGramCurrency" IS NULL) AND ("kursunGramPrice" IS NULL OR "kursunGramPrice" >= 0));
