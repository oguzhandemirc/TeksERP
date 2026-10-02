-- Backend güncellemesinin panel onayı (Dağıtım v2, GUNCELLEYICI.md §5.1): güncelleyicinin niyet dosyasına giden tetik.
-- Yalnız EKLER: boş doğan ekleme-yalnız tablo; canlı veriye dokunmaz. DEFERRABLE FK'lara dokunulmaz (DropForeignKey
-- satırı yok). İdempotent: yeniden koşum no-op.

CREATE TABLE IF NOT EXISTS "update_approvals" (
    "id" UUID NOT NULL,
    "clientToken" UUID,
    "version" VARCHAR(40) NOT NULL,
    "choice" VARCHAR(10) NOT NULL,
    "policyMode" VARCHAR(10),
    "approvedById" UUID NOT NULL,
    "approverName" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "update_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "update_approvals_clientToken_key" ON "update_approvals"("clientToken");

CREATE INDEX IF NOT EXISTS "update_approvals_createdAt_idx" ON "update_approvals"("createdAt");

-- Değer kümesi (HEMEN · PENCERE · GERI_AL) DB'de de kapalı: kod dışı yazım (elle SQL) yeni bir tür uyduramaz.
DO $onay_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'update_approvals_choice_check') THEN
    ALTER TABLE "update_approvals" ADD CONSTRAINT "update_approvals_choice_check" CHECK ("choice" IN ('HEMEN', 'PENCERE', 'GERI_AL'));
  END IF;
END
$onay_check$;

DO $onay_fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'update_approvals_approvedById_fkey') THEN
    ALTER TABLE "update_approvals" ADD CONSTRAINT "update_approvals_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$onay_fk$;
