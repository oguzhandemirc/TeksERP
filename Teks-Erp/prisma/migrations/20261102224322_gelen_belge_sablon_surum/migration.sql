-- S1 (Gülkesim 2026-11-03): kullanıcı şablonu sürüm geçmişi + belgenin okunduğu şablon sürümü. Yalnız ekleme (geri alınabilir değil, yıkıcı değil).
-- AlterTable
ALTER TABLE "customer_delivery_notes" ADD COLUMN     "templateVersion" SMALLINT;

-- CreateTable
CREATE TABLE "sender_template_versions" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" SMALLINT NOT NULL,
    "template" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sender_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sender_template_versions_createdById_idx" ON "sender_template_versions"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "sender_template_versions_templateId_version_key" ON "sender_template_versions"("templateId", "version");

-- AddForeignKey
ALTER TABLE "sender_template_versions" ADD CONSTRAINT "sender_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sender_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sender_template_versions" ADD CONSTRAINT "sender_template_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
