-- =============================================================================
-- Çoklu etiket şablonu seti (2026-11-11, Gülkesim): global set + müşteri seti.
-- `label_template_global_options` (bağlam başına herkes için ek şablonlar, sıralı) ·
-- `customer_label_template_options` (müşteri × bağlam başına ek şablonlar, sıralı) ·
-- `customers.labelShowGlobalTemplates` (müşteri listesinde global set görünsün mü, varsayılan açık) ·
-- `rolls.labelTemplateKind` (topun bir seferlik şablonunun seçildiği bağlam; aşama değişince uygulanmaz).
-- ADDITIVE ve idempotent. Veri göçü YOK: varsayılanlar `label_context_defaults` / `customer_template_routes`ta
-- kalır; boş tablolar = bugünkü çözüm (bayt-aynı). Geri alınamaz: rollback = restore.
-- rolls büyük tablo: nullable + varsayılansız ADD COLUMN yalnız katalog değişikliği — yine de zaman aşımı kapatılır.
-- =============================================================================
SET statement_timeout = 0;

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "labelShowGlobalTemplates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "labelTemplateKind" "LabelKind";

CREATE TABLE IF NOT EXISTS "label_template_global_options" (
    "id" UUID NOT NULL,
    "kind" "LabelKind" NOT NULL,
    "templateId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    CONSTRAINT "label_template_global_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_label_template_options" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" "LabelKind" NOT NULL,
    "templateId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    CONSTRAINT "customer_label_template_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "label_template_global_options_templateId_idx" ON "label_template_global_options"("templateId");
CREATE UNIQUE INDEX IF NOT EXISTS "label_template_global_options_kind_templateId_key" ON "label_template_global_options"("kind", "templateId");
CREATE INDEX IF NOT EXISTS "customer_label_template_options_templateId_idx" ON "customer_label_template_options"("templateId");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_label_template_options_customerId_kind_templateId_key" ON "customer_label_template_options"("customerId", "kind", "templateId");

DO $f$ BEGIN
  ALTER TABLE "label_template_global_options" ADD CONSTRAINT "label_template_global_options_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "label_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
DO $f$ BEGIN
  ALTER TABLE "label_template_global_options" ADD CONSTRAINT "label_template_global_options_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
DO $f$ BEGIN
  ALTER TABLE "label_template_global_options" ADD CONSTRAINT "label_template_global_options_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
DO $f$ BEGIN
  ALTER TABLE "customer_label_template_options" ADD CONSTRAINT "customer_label_template_options_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
DO $f$ BEGIN
  ALTER TABLE "customer_label_template_options" ADD CONSTRAINT "customer_label_template_options_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "label_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
DO $f$ BEGIN
  ALTER TABLE "customer_label_template_options" ADD CONSTRAINT "customer_label_template_options_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
DO $f$ BEGIN
  ALTER TABLE "customer_label_template_options" ADD CONSTRAINT "customer_label_template_options_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
