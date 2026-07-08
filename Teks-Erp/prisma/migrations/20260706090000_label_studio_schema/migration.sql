-- =============================================================================
-- ETİKET STÜDYOSU v2 — tek havuz + boyut varyantları + müşteri şablon ataması
-- =============================================================================
-- MANUEL migration (psql ile uygula + prisma migrate resolve --applied).
-- Additive + geri-uyumlu: kind/isDefault kolonları DEPRECATED olarak KALIR
-- (drop'lar saha onayı sonrası ayrı migration'da). Davranış F1'de birebir:
-- default kaynağı label_context_defaults'a taşınır, isDefault çift-yazımla
-- senkron tutulur.
-- =============================================================================

-- 1) Havuz-geneli benzersiz ad: farklı kind'larda aynı ad varsa kind sonekiyle
--    ayrıştır (bu DB'de bugün çakışma yok — savunmacı, idempotent no-op).
UPDATE label_templates t
SET name = t.name || CASE t.kind
  WHEN 'ROLL_RAW' THEN ' (Ham)'
  WHEN 'ROLL_FINISHED' THEN ' (Bitmiş)'
  ELSE ' (Kartela)'
END
WHERE EXISTS (
  SELECT 1 FROM label_templates o WHERE o.name = t.name AND o.id <> t.id
);

-- 2) kind kimlik olmaktan çıkar (DEPRECATED veri bağlamı bilgisi).
ALTER TABLE label_templates ALTER COLUMN kind DROP NOT NULL;

-- 3) Kind-kapsamlı kısıtlar → havuz-geneli kısıtlar.
DROP INDEX "label_templates_kind_name_key";
DROP INDEX "label_templates_kind_isDefault_idx";
DROP INDEX "label_templates_kind_isActive_idx";
DROP INDEX "label_templates_one_default_per_kind";
CREATE UNIQUE INDEX "label_templates_name_key" ON label_templates (name);
CREATE INDEX "label_templates_isActive_idx" ON label_templates ("isActive");

-- 4) Boyut varyantları — şablonun kanvas yerleşimi (tuval + eleman listesi).
CREATE TABLE label_template_variants (
  id UUID NOT NULL,
  "templateId" UUID NOT NULL,
  name VARCHAR(60) NOT NULL,
  "widthMm" DECIMAL(6,2) NOT NULL,
  "heightMm" DECIMAL(6,2) NOT NULL,
  "sourceProfileId" UUID,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  elements JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT label_template_variants_pkey PRIMARY KEY (id)
);
ALTER TABLE label_template_variants
  ADD CONSTRAINT "label_template_variants_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES label_templates (id)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE label_template_variants
  ADD CONSTRAINT "label_template_variants_sourceProfileId_fkey"
  FOREIGN KEY ("sourceProfileId") REFERENCES label_format_profiles (id)
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "label_template_variants_templateId_widthMm_heightMm_key"
  ON label_template_variants ("templateId", "widthMm", "heightMm");
CREATE INDEX "label_template_variants_sourceProfileId_idx"
  ON label_template_variants ("sourceProfileId");
-- Şablon başına tek primary (partial unique — Prisma şemasında native değil).
CREATE UNIQUE INDEX "label_template_variants_one_primary"
  ON label_template_variants ("templateId") WHERE "isPrimary" = true;

-- 5) Müşteriye özel şablon ataması (müşteri+bağlam → şablon).
CREATE TABLE customer_template_routes (
  id UUID NOT NULL,
  "customerId" UUID NOT NULL,
  kind "LabelKind" NOT NULL,
  "templateId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT customer_template_routes_pkey PRIMARY KEY (id)
);
ALTER TABLE customer_template_routes
  ADD CONSTRAINT "customer_template_routes_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES customers (id)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE customer_template_routes
  ADD CONSTRAINT "customer_template_routes_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES label_templates (id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "customer_template_routes_customerId_kind_key"
  ON customer_template_routes ("customerId", kind);
CREATE INDEX "customer_template_routes_templateId_idx"
  ON customer_template_routes ("templateId");

-- 6) Bağlam varsayılanı — eski "kind-başına isDefault"un yeni evi (kind UNIQUE
--    = bağlam başına tek default DB seddi).
CREATE TABLE label_context_defaults (
  id UUID NOT NULL,
  kind "LabelKind" NOT NULL,
  "templateId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT label_context_defaults_pkey PRIMARY KEY (id)
);
ALTER TABLE label_context_defaults
  ADD CONSTRAINT "label_context_defaults_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES label_templates (id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "label_context_defaults_kind_key"
  ON label_context_defaults (kind);
CREATE INDEX "label_context_defaults_templateId_idx"
  ON label_context_defaults ("templateId");

-- 7) Backfill: mevcut kind-başına default'lar yeni tabloya (davranış birebir).
INSERT INTO label_context_defaults (id, kind, "templateId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), kind, id, now(), now()
FROM label_templates
WHERE "isDefault" = true AND "isActive" = true AND "deletedAt" IS NULL AND kind IS NOT NULL;
