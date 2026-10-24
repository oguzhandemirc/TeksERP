-- Belge şablon tasarımcısı (T1B): şablon, değişmez sürüm, varsayılan ve profil ataması.
-- Plan: docs/design/BELGE-SABLON-TASARIMCISI-PLAN.md §3.5. İdempotent: IF NOT EXISTS + duplicate_object.
-- Sürüm satırı defter sınıfıdır: içerik UPDATE'i ve yayınlanmış sürümün DELETE'i trigger'la reddedilir.

-- CreateTable
CREATE TABLE IF NOT EXISTS "document_templates" (
    "id" UUID NOT NULL,
    "docType" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "editMode" VARCHAR(10) NOT NULL DEFAULT 'VISUAL',
    "copiedFrom" VARCHAR(80),
    "publishedVersionId" UUID,
    "latestVersionNo" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "document_template_versions" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "editMode" VARCHAR(10) NOT NULL,
    "sourceHtml" TEXT NOT NULL,
    "css" TEXT NOT NULL,
    "compiledLiquid" TEXT NOT NULL,
    "projectData" JSONB,
    "pageSettings" JSONB NOT NULL,
    "tableBindings" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "internalFields" JSONB NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "engineVersion" VARCHAR(40) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "note" VARCHAR(300),
    "removedOnSave" JSONB NOT NULL,
    "clientToken" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ,
    "publishedById" UUID,

    CONSTRAINT "document_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "document_template_defaults" (
    "id" UUID NOT NULL,
    "docType" VARCHAR(40) NOT NULL,
    "templateId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "document_template_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "document_profile_templates" (
    "profileId" UUID NOT NULL,
    "docType" VARCHAR(40) NOT NULL,
    "templateId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "document_profile_templates_pkey" PRIMARY KEY ("profileId","docType")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_publishedVersionId_key" ON "document_templates"("publishedVersionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_clientToken_key" ON "document_templates"("clientToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "document_templates_docType_status_idx" ON "document_templates"("docType", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_docType_name_key" ON "document_templates"("docType", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "document_template_versions_clientToken_key" ON "document_template_versions"("clientToken");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "document_template_versions_templateId_versionNo_key" ON "document_template_versions"("templateId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "document_template_defaults_docType_key" ON "document_template_defaults"("docType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "document_template_defaults_templateId_idx" ON "document_template_defaults"("templateId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "document_profile_templates_templateId_idx" ON "document_profile_templates"("templateId");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "document_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "document_template_defaults" ADD CONSTRAINT "document_template_defaults_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "document_profile_templates" ADD CONSTRAINT "document_profile_templates_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "document_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "document_profile_templates" ADD CONSTRAINT "document_profile_templates_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CHECK'ler (ŞEMA-DIŞI; test_db_invariants CHECK_CONSTRAINTS)
DO $$ BEGIN ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_edit_mode_check" CHECK ("editMode" IN ('VISUAL', 'CODE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_edit_mode_check" CHECK ("editMode" IN ('VISUAL', 'CODE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Değişmez sürüm: içerik kolonları hiç değişmez; publishedAt/publishedById yalnız NULL→değer (bir kez).
-- DELETE yalnız hiç yayınlanmamış sürümde geçer (taslak şablonun hard delete'i — taslak sınıfı).
CREATE OR REPLACE FUNCTION document_template_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."publishedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'document_template_versions: yayınlanmış sürüm silinemez (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
     OR NEW."versionNo" IS DISTINCT FROM OLD."versionNo"
     OR NEW."editMode" IS DISTINCT FROM OLD."editMode"
     OR NEW."sourceHtml" IS DISTINCT FROM OLD."sourceHtml"
     OR NEW."css" IS DISTINCT FROM OLD."css"
     OR NEW."compiledLiquid" IS DISTINCT FROM OLD."compiledLiquid"
     OR NEW."projectData" IS DISTINCT FROM OLD."projectData"
     OR NEW."pageSettings" IS DISTINCT FROM OLD."pageSettings"
     OR NEW."tableBindings" IS DISTINCT FROM OLD."tableBindings"
     OR NEW."settings" IS DISTINCT FROM OLD."settings"
     OR NEW."internalFields" IS DISTINCT FROM OLD."internalFields"
     OR NEW."contractVersion" IS DISTINCT FROM OLD."contractVersion"
     OR NEW."engineVersion" IS DISTINCT FROM OLD."engineVersion"
     OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."removedOnSave" IS DISTINCT FROM OLD."removedOnSave"
     OR NEW."clientToken" IS DISTINCT FROM OLD."clientToken"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'document_template_versions: sürüm içeriği değiştirilemez (id=%)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD."publishedAt" IS NOT NULL AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt")
     OR (OLD."publishedById" IS NOT NULL AND NEW."publishedById" IS DISTINCT FROM OLD."publishedById")
     OR (OLD."publishedAt" IS NULL AND NEW."publishedAt" IS NULL AND NEW."publishedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'document_template_versions: yayın damgası yalnız bir kez yazılır (id=%)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "document_template_versions_block_tamper" ON "document_template_versions";
CREATE TRIGGER "document_template_versions_block_tamper"
  BEFORE UPDATE OR DELETE ON "document_template_versions"
  FOR EACH ROW EXECUTE FUNCTION document_template_version_guard();
