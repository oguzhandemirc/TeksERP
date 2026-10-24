-- Kurşun gramajı: iş emri hedefi + kâğıt dağıtım gramajı (KQ-D6, 2026-10-24)
--
-- `work_order_target_values`: İE'nin HEDEF çeşit değeri (plan alanı; toplara
-- YAYILMAZ, sapma türetilir). Değişim eski satırı damgalar (`revokedAt`) +
-- yenisini yazar; AKTİF (workOrderId, propertyId) tekil → PARTIAL unique.
-- `kursun_bypass_assignments."propertyValueId"`: kâğıt rejiminde isteğe bağlı
-- gramaj; RollOperation yazılmaz (bypass kuralı değişmez).
-- Ekleyici ve idempotent; `DropForeignKey` satırları (prisma diff gürültüsü) SİLİNDİ. Backfill YOK.

-- AlterTable
ALTER TABLE "kursun_bypass_assignments" ADD COLUMN IF NOT EXISTS "propertyValueId" UUID;

-- CreateTable
CREATE TABLE IF NOT EXISTS "work_order_target_values" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "valueId" UUID NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "work_order_target_values_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_order_target_values_propertyId_idx" ON "work_order_target_values"("propertyId");
CREATE INDEX IF NOT EXISTS "work_order_target_values_valueId_idx" ON "work_order_target_values"("valueId");

-- AKTİF hedef tekil; damgalı geçmiş satırlar dururken yenisi yazılabilsin.
-- Şemada `@@unique(map:)` — drift bekçisi predicate'i saymaz.
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_target_values_active_uq"
  ON "work_order_target_values"("workOrderId", "propertyId") WHERE "revokedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "kursun_bypass_assignments_propertyValueId_idx" ON "kursun_bypass_assignments"("propertyValueId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kursun_bypass_assignments_propertyValueId_fkey') THEN
    ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_propertyValueId_fkey"
      FOREIGN KEY ("propertyValueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_target_values_workOrderId_fkey') THEN
    ALTER TABLE "work_order_target_values" ADD CONSTRAINT "work_order_target_values_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_target_values_propertyId_fkey') THEN
    ALTER TABLE "work_order_target_values" ADD CONSTRAINT "work_order_target_values_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_target_values_valueId_fkey') THEN
    ALTER TABLE "work_order_target_values" ADD CONSTRAINT "work_order_target_values_valueId_fkey"
      FOREIGN KEY ("valueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
