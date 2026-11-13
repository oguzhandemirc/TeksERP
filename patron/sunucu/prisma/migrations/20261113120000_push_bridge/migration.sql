-- =============================================================================
-- PUSH KÖPRÜSÜ (P1): fabrika → bulut imzalı istek (amaç `bildir`) ile kurulum ↔ belirteç ÖZETİ bağı, Expo bileti ve
-- nonce defteri. MERKEZ tabloları (yalnız merkezde dolu ve yetkili — `src/lib/db-grants.ts` MERKEZ_SYNC_GRANTS);
-- kiracı verisi değildir ⇒ RLS taşımaz. Yalnız EKLER (yeni tablolar); mevcut veri DEĞİŞMEZ. Ham belirteç ve bildirim
-- metni hiçbir kolonda yok: özet kolonu CHECK ile 64 hex'e kilitli.
-- =============================================================================

-- CreateTable
CREATE TABLE "push_bridge_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kurulum_id" UUID NOT NULL,
    "token_digest" VARCHAR(64) NOT NULL,
    "invalidated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_bridge_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_bridge_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kurulum_id" UUID NOT NULL,
    "token_digest" VARCHAR(64) NOT NULL,
    "ticket" VARCHAR(100) NOT NULL,
    "receipt_due_at" TIMESTAMPTZ,
    "result" VARCHAR(60),
    "sent_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_bridge_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_bridge_nonces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kurulum_id" UUID NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_bridge_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_bridge_links_kurulum_id_token_digest_key" ON "push_bridge_links"("kurulum_id", "token_digest");

-- CreateIndex
CREATE UNIQUE INDEX "push_bridge_tickets_ticket_key" ON "push_bridge_tickets"("ticket");

-- CreateIndex
CREATE INDEX "push_bridge_tickets_receipt_due_at_idx" ON "push_bridge_tickets"("receipt_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_bridge_nonces_kurulum_id_nonce_key" ON "push_bridge_nonces"("kurulum_id", "nonce");

-- CreateIndex
CREATE INDEX "push_bridge_nonces_expires_at_idx" ON "push_bridge_nonces"("expires_at");

-- Özet sedleri: ham Expo belirteci (`ExponentPushToken[…]`) bu kolonlara yazılamaz.
ALTER TABLE "push_bridge_links" ADD CONSTRAINT "push_bridge_links_token_digest_hex" CHECK ("token_digest" ~ '^[0-9a-f]{64}$');
ALTER TABLE "push_bridge_tickets" ADD CONSTRAINT "push_bridge_tickets_token_digest_hex" CHECK ("token_digest" ~ '^[0-9a-f]{64}$');
