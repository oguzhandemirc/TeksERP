-- CreateEnum
CREATE TYPE "PrintedDocType" AS ENUM ('SHIPMENT_DISPATCH', 'SUBCONTRACTOR_DISPATCH', 'KARTELA_DISPATCH');

-- CreateEnum
CREATE TYPE "PrintedDocStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'VOIDED');

-- CreateTable
CREATE TABLE "printed_documents" (
    "id" TEXT NOT NULL,
    "docType" "PrintedDocType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PrintedDocStatus" NOT NULL DEFAULT 'ACTIVE',
    "documentNo" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reissueReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "printedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printed_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "printed_documents_docType_sourceId_status_idx" ON "printed_documents"("docType", "sourceId", "status");

-- CreateIndex
CREATE INDEX "printed_documents_printedById_idx" ON "printed_documents"("printedById");

-- CreateIndex
CREATE UNIQUE INDEX "printed_documents_docType_sourceId_version_key" ON "printed_documents"("docType", "sourceId", "version");

-- AddForeignKey
ALTER TABLE "printed_documents" ADD CONSTRAINT "printed_documents_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
