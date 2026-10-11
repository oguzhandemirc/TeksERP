-- G1 SİSTEM HESABI MÜHRÜ: kurulum anahtarıyla (lisans çekirdeğinde) imzalı `sm1.<kid>.<imza>`.
-- ADDITIVE: bir nullable kolon + bir CHECK; mevcut satırlar NULL (mühürsüz — mandalsız kurulumda bugünkü
-- davranış), veri dönüşümü yok. Mühür zorunluluğu DB'de değil LICENSE_DIR mandalındadır. İdempotent.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "systemAccountSeal" VARCHAR(200);

DO $sistem_muhur$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_system_account_seal_only_system') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_system_account_seal_only_system"
      CHECK ("systemAccountSeal" IS NULL OR "isSystemAccount");
  END IF;
END
$sistem_muhur$;
