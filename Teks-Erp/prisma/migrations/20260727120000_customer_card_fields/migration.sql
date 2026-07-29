-- "Her şube = ayrı müşteri" düzeni: şube kartında yaşayan alanlar müşteri kartına
-- taşındı. Tümü nullable + salt ADD COLUMN — mevcut satırlar dokunulmadan null kalır
-- (canlı üretim DB'sinde güvenli, rewrite/lock yok).
-- Elle yazıldı: `migrate dev` bilinen spurious drift (sacks_customerId_fkey raw FK)
-- yüzünden reset istiyor — bkz. 20260715154754 başlık notu.

-- AlterTable
ALTER TABLE "customers"
  ADD COLUMN "exportCode" VARCHAR(50),
  ADD COLUMN "address" TEXT,
  ADD COLUMN "city" VARCHAR(80),
  ADD COLUMN "district" VARCHAR(80),
  ADD COLUMN "country" VARCHAR(80),
  ADD COLUMN "contactName" VARCHAR(120),
  ADD COLUMN "contactPhone" VARCHAR(40),
  ADD COLUMN "email" VARCHAR(200),
  ADD COLUMN "notes" TEXT;
