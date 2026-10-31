-- V1 (D4-SEMA; B-1 kullanıcı kararı 2026-10-31): KDV + tevkifat genel ayar (system_settings, migration'sız) +
-- MÜŞTERİ bazında geçersiz kılma. Alan cari hesapta: finansal kimlik tek (MASTER-VERI-TASARIMI; vergi dairesi,
-- vade, hizmet faturası tetiği emsali). NULL = genel ayar ⇒ mevcut satırlar bugünkü gibi.
-- ADDITIVE: dört nullable kolon + CHECK; toplu UPDATE yok. Fatura satırı oranı zaten doğuşta damgalı.

ALTER TABLE "cari_accounts" ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(5,2);
ALTER TABLE "cari_accounts" ADD COLUMN IF NOT EXISTS "withholdingEnabled" BOOLEAN;
ALTER TABLE "cari_accounts" ADD COLUMN IF NOT EXISTS "withholdingNumerator" SMALLINT;
ALTER TABLE "cari_accounts" ADD COLUMN IF NOT EXISTS "withholdingDenominator" SMALLINT;

DO $ck$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_accounts_vat_override_ck') THEN
    ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_vat_override_ck" CHECK ("vatRate" IS NULL OR ("vatRate" >= 0 AND "vatRate" <= 100));
  END IF;
  -- Pay/payda birlikte: yarım oran (yalnız pay) hesaplanamaz; oran 0 < pay/payda ≤ 1. IS NOT NULL açık: NULL karşılaştırma CHECK'i geçirirdi.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cari_accounts_withholding_ck') THEN
    ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_withholding_ck" CHECK (
      ("withholdingNumerator" IS NULL AND "withholdingDenominator" IS NULL)
      OR ("withholdingNumerator" IS NOT NULL AND "withholdingDenominator" IS NOT NULL
          AND "withholdingNumerator" >= 1 AND "withholdingDenominator" >= "withholdingNumerator")
    );
  END IF;
END $ck$;
