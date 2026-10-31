-- K3d (D4-SEMA; kullanıcı kararı 2026-10-30): cari virman bacak bağı + aktarılan vade + birleştirilmiş hesap işareti.
-- ADDITIVE: üç nullable kolon + index + FK + CHECK; toplu UPDATE/DELETE yok. Mevcut satırlar CHECK'leri sağlar
-- (bugün hiçbir satır CARI_TRANSFER* değil, kolonlar NULL doğar).

ALTER TABLE "cari_transactions" ADD COLUMN IF NOT EXISTS "transferGroupId" UUID;
ALTER TABLE "cari_transactions" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMPTZ;
ALTER TABLE "cari_accounts" ADD COLUMN IF NOT EXISTS "mergedIntoId" UUID;

CREATE INDEX IF NOT EXISTS "cari_transactions_transferGroupId_idx" ON "cari_transactions"("transferGroupId");
CREATE INDEX IF NOT EXISTS "cari_accounts_mergedIntoId_idx" ON "cari_accounts"("mergedIntoId");

DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_accounts_mergedIntoId_fkey') THEN
    ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $fk$;

DO $ck$ BEGIN
  -- Virman bacakları gruplu doğar (kasa virmanı `cash_transactions` emsali); başka kaynak grup taşımaz.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_transactions_transfer_group_ck') THEN
    ALTER TABLE "cari_transactions" ADD CONSTRAINT "cari_transactions_transfer_group_ck" CHECK (
      ("sourceType" IN ('CARI_TRANSFER', 'CARI_TRANSFER_CANCEL')) = ("transferGroupId" IS NOT NULL)
    );
  END IF;
  -- Virman stornosu orijinal bacağına bağlı doğar (yeni değer, geriye dolum yok).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_transactions_transfer_cancel_link_ck') THEN
    ALTER TABLE "cari_transactions" ADD CONSTRAINT "cari_transactions_transfer_cancel_link_ck" CHECK (
      "sourceType" <> 'CARI_TRANSFER_CANCEL' OR "reversesTxnId" IS NOT NULL
    );
  END IF;
  -- Vade yalnız aktarılan açık kalemde anlamlı.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_transactions_transfer_due_ck') THEN
    ALTER TABLE "cari_transactions" ADD CONSTRAINT "cari_transactions_transfer_due_ck" CHECK (
      "dueDate" IS NULL OR "sourceType" = 'CARI_TRANSFER'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_accounts_merged_self_ck') THEN
    ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_merged_self_ck" CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_accounts_merged_inactive_ck') THEN
    ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_merged_inactive_ck" CHECK ("mergedIntoId" IS NULL OR "isActive" = false);
  END IF;
END $ck$;
