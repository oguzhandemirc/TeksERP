-- Belge genişletmesi: 5 yeni PrintedDocType değeri + FreeDocument (serbest belge).
-- ADD VALUE IF NOT EXISTS her biri auto-commit (enum değeri aynı tx'te kullanılamaz —
-- runtime'da kullanılıyor, sorun yok). FreeDocument salt-eklemeli tablo.

ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'SUBCONTRACTOR_RECEIPT';
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'QUALITY_CERTIFICATE';
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'PACKING_LIST';
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'COMMERCIAL_INVOICE';
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'RETURN_DISPATCH';

CREATE TABLE "free_documents" (
    "id" UUID NOT NULL,
    "documentNo" VARCHAR(64) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "recipient" VARCHAR(200),
    "body" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "free_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "free_documents_documentNo_key" ON "free_documents"("documentNo");
