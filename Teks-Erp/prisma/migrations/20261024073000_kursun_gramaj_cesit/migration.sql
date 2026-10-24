-- Kurşun gramajı: çeşit bağı + defter değeri (KQ-D4, 2026-10-24)
--
-- Yeni ana veri tablosu YOK (KARAR K5): gramaj mevcut SEÇİM tipli özelliktir;
-- "bu SEÇİM şu BAYRAĞIN çeşididir" bağı `fabric_properties.variantOfPropertyId`,
-- basılan değer `roll_operations.propertyValueId` (ileri kaydın parçası; ters
-- mekanizma aynen DAMGA `revokedAt`). Backfill YOK: bağ boşken davranış bugünkü.
-- Ekleyici ve idempotent; `DropForeignKey` satırları (prisma diff gürültüsü) SİLİNDİ.

-- AlterTable
ALTER TABLE "fabric_properties" ADD COLUMN IF NOT EXISTS "variantOfPropertyId" UUID;

-- AlterTable
ALTER TABLE "roll_operations" ADD COLUMN IF NOT EXISTS "propertyValueId" UUID;

-- Bir bayrağın en fazla BİR çeşidi. PARTIAL (NULL'lar zaten çakışmaz; predicate
-- niyeti yazılı kılar). Şemada `@unique(map:)` — drift bekçisi predicate'i saymaz.
CREATE UNIQUE INDEX IF NOT EXISTS "fabric_properties_variant_of_uq"
  ON "fabric_properties"("variantOfPropertyId") WHERE "variantOfPropertyId" IS NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "roll_operations_propertyValueId_idx" ON "roll_operations"("propertyValueId");

-- AddForeignKey (RESTRICT: değer/bayrak yazılmış izin altından silinemez)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_operations_propertyValueId_fkey') THEN
    ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_propertyValueId_fkey"
      FOREIGN KEY ("propertyValueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fabric_properties_variantOfPropertyId_fkey') THEN
    ALTER TABLE "fabric_properties" ADD CONSTRAINT "fabric_properties_variantOfPropertyId_fkey"
      FOREIGN KEY ("variantOfPropertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- Değer yalnız KURSUN_APPLIED satırında anlamlıdır (QC2/fason satırına yazılamaz).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roll_operations_property_value_ck') THEN
    ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_property_value_ck"
      CHECK ("propertyValueId" IS NULL OR "operationType" = 'KURSUN_APPLIED');
  END IF;
  -- Kendine bağ yok (servis de 400 verir; bu sed ham SQL/içe aktarma yoluna).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fabric_properties_variant_not_self_ck') THEN
    ALTER TABLE "fabric_properties" ADD CONSTRAINT "fabric_properties_variant_not_self_ck"
      CHECK ("variantOfPropertyId" IS NULL OR "variantOfPropertyId" <> "id");
  END IF;
END $$;
