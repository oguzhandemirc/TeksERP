-- Genel fason F3 (2026-11-08): süreç türü (SubcontractorCategory) → hizmet kartı eşlemesi.
-- ADDITIVE: yeni tablo + unique/index + iki FK. Veri değişikliği YOK; boş tablo = adım işi yok =
-- bugünkü davranış (ayar `finance.serviceBilling.stepWorks` de varsayılan kapalı).
-- Üretilen iki `DropForeignKey` satırı (rolls/swatches consistency FK) bilinçli silindi (reçete).

CREATE TABLE IF NOT EXISTS "service_item_processes" (
    "id" UUID NOT NULL,
    "serviceItemId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "service_item_processes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_item_processes_categoryId_key" ON "service_item_processes"("categoryId");

CREATE INDEX IF NOT EXISTS "service_item_processes_serviceItemId_idx" ON "service_item_processes"("serviceItemId");

DO $fk$ BEGIN
  ALTER TABLE "service_item_processes" ADD CONSTRAINT "service_item_processes_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

DO $fk$ BEGIN
  ALTER TABLE "service_item_processes" ADD CONSTRAINT "service_item_processes_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "subcontractor_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
