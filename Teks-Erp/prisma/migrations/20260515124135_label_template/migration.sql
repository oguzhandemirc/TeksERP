-- CreateEnum
CREATE TYPE "LabelKind" AS ENUM ('ROLL', 'SWATCH', 'SHIPMENT_DOCKET');

-- CreateTable
CREATE TABLE "label_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LabelKind" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "label_templates_kind_isDefault_idx" ON "label_templates"("kind", "isDefault");

-- CreateIndex
CREATE INDEX "label_templates_kind_isActive_idx" ON "label_templates"("kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "label_templates_kind_name_key" ON "label_templates"("kind", "name");
