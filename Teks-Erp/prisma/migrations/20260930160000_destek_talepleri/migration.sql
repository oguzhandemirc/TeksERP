-- Destek talepleri (3d-2). Yalnız EKLER: durum tablosu (giden kutusu + satıcı aynası) + satıcı yanıtlarının
-- ekleme-yalnız kopyası. Canlı veriye dokunmaz; DEFERRABLE FK'lara dokunulmaz (DropForeignKey satırları çıkarıldı).
-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "clientToken" UUID,
    "subject" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "screenshot" BYTEA,
    "screenshotType" VARCHAR(20),
    "panelVersion" VARCHAR(60),
    "status" VARCHAR(20) NOT NULL DEFAULT 'GONDERILMEDI',
    "ticketNo" VARCHAR(40),
    "sentAt" TIMESTAMPTZ,
    "lastSyncedAt" TIMESTAMPTZ,
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(60),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_replies" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "vendorReplyId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "repliedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_clientToken_key" ON "support_tickets"("clientToken");

-- CreateIndex
CREATE INDEX "support_tickets_status_updatedAt_idx" ON "support_tickets"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_replies_vendorReplyId_key" ON "support_ticket_replies"("vendorReplyId");

-- CreateIndex
CREATE INDEX "support_ticket_replies_ticketId_repliedAt_idx" ON "support_ticket_replies"("ticketId", "repliedAt");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_replies" ADD CONSTRAINT "support_ticket_replies_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

