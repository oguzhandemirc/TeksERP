-- İki kişilik kimlik sıfırlama onayı (güvenlik denetimi Bölge 2 B1b): aktörden daha yetkili bir hesabın parola /
-- iki adımlı doğrulama / hızlı PIN / kart sıfırlaması talep → ikinci yetkili onayı → uygulama akışından geçer.
-- Yalnız EKLER: boş doğan tablo; canlı veriye dokunmaz. DEFERRABLE FK'lara dokunulmaz (DropForeignKey satırı yok).
-- İdempotent: yeniden koşum no-op.

CREATE TABLE IF NOT EXISTS "credential_reset_requests" (
    "id" UUID NOT NULL,
    "clientToken" UUID,
    "targetUserId" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "reason" VARCHAR(500),
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "credential_reset_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credential_reset_requests_clientToken_key" ON "credential_reset_requests"("clientToken");
CREATE INDEX IF NOT EXISTS "credential_reset_requests_status_createdAt_idx" ON "credential_reset_requests"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "credential_reset_requests_targetUserId_idx" ON "credential_reset_requests"("targetUserId");

-- Değer kümeleri DB'de de kapalı; karar damgası ile durum birlikte değişir (PENDING ↔ karar alanları boş).
DO $kimlik_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_reset_requests_kind_check') THEN
    ALTER TABLE "credential_reset_requests" ADD CONSTRAINT "credential_reset_requests_kind_check" CHECK ("kind" IN ('PASSWORD', 'TOTP', 'QUICK_PIN', 'CARD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_reset_requests_status_check') THEN
    ALTER TABLE "credential_reset_requests" ADD CONSTRAINT "credential_reset_requests_status_check" CHECK ("status" IN ('PENDING', 'APPLIED', 'REJECTED', 'CANCELLED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_reset_requests_decision_check') THEN
    ALTER TABLE "credential_reset_requests" ADD CONSTRAINT "credential_reset_requests_decision_check" CHECK (("status" = 'PENDING') = ("decidedById" IS NULL AND "decidedAt" IS NULL));
  END IF;
END
$kimlik_check$;

DO $kimlik_fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_reset_requests_targetUserId_fkey') THEN
    ALTER TABLE "credential_reset_requests" ADD CONSTRAINT "credential_reset_requests_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_reset_requests_requestedById_fkey') THEN
    ALTER TABLE "credential_reset_requests" ADD CONSTRAINT "credential_reset_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_reset_requests_decidedById_fkey') THEN
    ALTER TABLE "credential_reset_requests" ADD CONSTRAINT "credential_reset_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$kimlik_fk$;
