-- F7 (fason planı FK4, 2026-11-08): ALIŞ faturası tevkifat ön değeri — cari geçersiz kılması.
-- Genel ayar system_settings'te (`finance.withholding.purchase.*`, migration'sız); burada yalnız cari kolonları.
-- ADDITIVE: üç nullable kolon + CHECK; toplu UPDATE yok. NULL = genel ayar ⇒ mevcut satırlar bugünkü gibi.

ALTER TABLE "cari_accounts" ADD COLUMN IF NOT EXISTS "purchaseWithholdingEnabled" BOOLEAN;
ALTER TABLE "cari_accounts" ADD COLUMN IF NOT EXISTS "purchaseWithholdingNumerator" SMALLINT;
ALTER TABLE "cari_accounts" ADD COLUMN IF NOT EXISTS "purchaseWithholdingDenominator" SMALLINT;

DO $ck$ BEGIN
  -- Satış seddinin (`cari_accounts_withholding_ck`) ikizi: pay/payda birlikte, 1 ≤ pay ≤ payda.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_accounts_purchase_withholding_ck') THEN
    ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_purchase_withholding_ck" CHECK (
      ("purchaseWithholdingNumerator" IS NULL AND "purchaseWithholdingDenominator" IS NULL)
      OR ("purchaseWithholdingNumerator" IS NOT NULL AND "purchaseWithholdingDenominator" IS NOT NULL
          AND "purchaseWithholdingNumerator" >= 1 AND "purchaseWithholdingDenominator" >= "purchaseWithholdingNumerator")
    );
  END IF;
END $ck$;
