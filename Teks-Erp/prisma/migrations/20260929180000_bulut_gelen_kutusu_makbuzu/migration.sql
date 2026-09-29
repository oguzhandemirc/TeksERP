-- Patron bulutu gelen kutusu makbuzu (B3). Yalnız EKLER: yeni iki enum + ekleme-yalnız tablo.

-- CreateEnum
CREATE TYPE "CloudInboxKind" AS ENUM ('SIPARIS', 'CARI');

-- CreateEnum
CREATE TYPE "CloudInboxOutcome" AS ENUM ('ISLENDI', 'REDDEDILDI');

-- CreateTable
CREATE TABLE "cloud_inbox_receipts" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "kind" "CloudInboxKind" NOT NULL,
    "outcome" "CloudInboxOutcome" NOT NULL,
    "entityId" UUID,
    "cloudAccountId" UUID NOT NULL,
    "cloudAccountName" VARCHAR(200) NOT NULL,
    "payloadDigest" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloud_inbox_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cloud_inbox_receipts_messageId_key" ON "cloud_inbox_receipts"("messageId");

-- Çift yüklem: işlenen mesaj varlık taşır, reddedilen taşımaz.
ALTER TABLE "cloud_inbox_receipts" ADD CONSTRAINT "cloud_inbox_receipts_outcome_entity_chk"
    CHECK (("outcome" = 'ISLENDI' AND "entityId" IS NOT NULL) OR ("outcome" = 'REDDEDILDI' AND "entityId" IS NULL));
