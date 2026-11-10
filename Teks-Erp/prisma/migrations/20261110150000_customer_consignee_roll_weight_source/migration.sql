-- =============================================================================
-- Alıcı kataloğu + top kg kaynağı (2026-11-10, tambur fason etiket planı B1).
-- `customer_consignees`: müşterimizin müşterisi (etikete basılan ad), sahip (customers) kapsamlı;
-- ad tekilliği sahip başına katlanmış ad, mezar taşı hariç (customers_nameFold_key emsali);
-- alıcıya bağlı opsiyonel etiket şablonu (labelTemplateId).
-- `rolls.labelConsigneeId` (etiketin alıcısı, miras geçmez) + `rolls.weightSource` (kg kaynağı,
-- enum çuvalla ortak `SackWeightSource`). ADDITIVE ve idempotent; yeni tablo boş doğar, yumuşak kapı
-- gerekmez. Şema dışı nesneler (generated kolon, partial unique) → scripts/test_db_invariants.ts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "customer_consignees" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" VARCHAR(80) COLLATE public.tr_sort NOT NULL,
    "nameFold" TEXT GENERATED ALWAYS AS (public.tr_fold("name")) STORED,
    "labelTemplateId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" UUID,
    "mergedAt" TIMESTAMPTZ,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "customer_consignees_pkey" PRIMARY KEY ("id")
);

-- Canlı ad tekilliği sahip başına; mezar taşı aynı katlanmış adı taşır (predicate dışarıda bırakır).
CREATE UNIQUE INDEX IF NOT EXISTS "customer_consignees_customerId_nameFold_key"
  ON "customer_consignees"("customerId", "nameFold") WHERE "mergedIntoId" IS NULL;
CREATE INDEX IF NOT EXISTS "customer_consignees_customerId_isActive_idx" ON "customer_consignees"("customerId", "isActive");
CREATE INDEX IF NOT EXISTS "customer_consignees_labelTemplateId_idx" ON "customer_consignees"("labelTemplateId");
CREATE INDEX IF NOT EXISTS "customer_consignees_mergedIntoId_idx" ON "customer_consignees"("mergedIntoId");

DO $f$ BEGIN
  ALTER TABLE "customer_consignees" ADD CONSTRAINT "customer_consignees_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
DO $f$ BEGIN
  ALTER TABLE "customer_consignees" ADD CONSTRAINT "customer_consignees_labelTemplateId_fkey"
    FOREIGN KEY ("labelTemplateId") REFERENCES "label_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
DO $f$ BEGIN
  ALTER TABLE "customer_consignees" ADD CONSTRAINT "customer_consignees_mergedIntoId_fkey"
    FOREIGN KEY ("mergedIntoId") REFERENCES "customer_consignees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;

ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "labelConsigneeId" UUID;
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "weightSource" "SackWeightSource";
CREATE INDEX IF NOT EXISTS "rolls_labelConsigneeId_createdAt_idx" ON "rolls"("labelConsigneeId", "createdAt");
DO $f$ BEGIN
  ALTER TABLE "rolls" ADD CONSTRAINT "rolls_labelConsigneeId_fkey"
    FOREIGN KEY ("labelConsigneeId") REFERENCES "customer_consignees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
