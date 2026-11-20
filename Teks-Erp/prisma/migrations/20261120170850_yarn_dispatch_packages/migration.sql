-- Devere H1 — iplik sevk / iade satırına koli ve bobin adedi (BİLGİ alanı; defter değil, kg tek kaynak).
-- Yalnız ekleme: nullable kolonlar + "null ya da > 0" CHECK'leri (mevcut satırlar NULL → kısıtı geçer).

-- AlterTable
ALTER TABLE "subcontractor_dispatch_items" ADD COLUMN IF NOT EXISTS "bobbinCount" INTEGER,
ADD COLUMN IF NOT EXISTS "packageCount" INTEGER;

-- AlterTable
ALTER TABLE "yarn_movements" ADD COLUMN IF NOT EXISTS "packageCount" INTEGER;

DO $$ BEGIN
  ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_package_positive" CHECK (
    "packageCount" IS NULL OR "packageCount" > 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_bobbin_positive" CHECK (
    "bobbinCount" IS NULL OR "bobbinCount" > 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_package_positive" CHECK (
    "packageCount" IS NULL OR "packageCount" > 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
