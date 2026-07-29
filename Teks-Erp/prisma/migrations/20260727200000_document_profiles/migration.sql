-- Belge şablon profilleri (DocumentProfile) + Customer/Subcontractor atama FK'ları.
-- Salt-eklemeli migration — mevcut veri etkilenmez (canlı kurulumda güvenli).

-- CreateTable
CREATE TABLE "document_profiles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_profiles_name_key" ON "document_profiles"("name");

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "documentProfileId" UUID;
ALTER TABLE "subcontractors" ADD COLUMN "documentProfileId" UUID;

-- CreateIndex
CREATE INDEX "customers_documentProfileId_idx" ON "customers"("documentProfileId");
CREATE INDEX "subcontractors_documentProfileId_idx" ON "subcontractors"("documentProfileId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_documentProfileId_fkey"
  FOREIGN KEY ("documentProfileId") REFERENCES "document_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_documentProfileId_fkey"
  FOREIGN KEY ("documentProfileId") REFERENCES "document_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
