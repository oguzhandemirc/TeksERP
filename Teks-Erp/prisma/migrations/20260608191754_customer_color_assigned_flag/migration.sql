-- AlterTable
ALTER TABLE "customer_color_aliases" ADD COLUMN     "assigned" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: alias-yok satırlar renk formu atamasından gelir (assigned=true);
-- alias-dolu satırlar müşteri panelinden ad verilenlerdir (assigned=false kalır).
UPDATE "customer_color_aliases" SET "assigned" = true WHERE "alias" IS NULL;
