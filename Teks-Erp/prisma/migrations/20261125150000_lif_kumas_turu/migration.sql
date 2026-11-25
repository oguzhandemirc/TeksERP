-- K7 + K8 (Seyitoğlu, kullanıcı kararı 2026-11-25): iplik lif bileşimi + kumaş türü + yanmazlık.
-- ADDITIVE / EXPAND: yeni tip, iki katalog tablosu, bir pivot, items'a iki boş bırakılabilir kolon.
-- Veri dönüştürme YOK; yalnız iki kataloğa varsayılan satırlar (ad çakışırsa dokunulmaz). Kısıt sıkılaşmaz.
-- Tip bu dosyada DOĞUYOR (CREATE TYPE) → ADD VALUE kısıtı (55P04) yok.

-- CreateEnum
DO $t$ BEGIN CREATE TYPE "FlameRetardancy" AS ENUM ('NONE', 'FR_YARN', 'TREVIRA_CS', 'OTHER_FR');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "fabric_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fabric_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "fabric_types_name_key" ON "fabric_types"("name");

CREATE TABLE IF NOT EXISTS "fiber_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "abbreviation" VARCHAR(8),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fiber_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "fiber_types_name_key" ON "fiber_types"("name");

CREATE TABLE IF NOT EXISTS "item_fibers" (
    "itemId" UUID NOT NULL,
    "fiberTypeId" UUID NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_fibers_pkey" PRIMARY KEY ("itemId","fiberTypeId")
);
CREATE INDEX IF NOT EXISTS "item_fibers_fiberTypeId_idx" ON "item_fibers"("fiberTypeId");
DO $t$ BEGIN ALTER TABLE "item_fibers" ADD CONSTRAINT "item_fibers_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
DO $t$ BEGIN ALTER TABLE "item_fibers" ADD CONSTRAINT "item_fibers_fiberTypeId_fkey" FOREIGN KEY ("fiberTypeId") REFERENCES "fiber_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;
-- Satır payı 0 < pct ≤ 100 (Σ = 100 servis kapısı; satırlar arası CHECK yazılamaz).
DO $t$ BEGIN ALTER TABLE "item_fibers" ADD CONSTRAINT "item_fibers_pct_ck" CHECK ("pct" > 0 AND "pct" <= 100); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- AlterTable
ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "fabricTypeId" UUID,
  ADD COLUMN IF NOT EXISTS "flameRetardancy" "FlameRetardancy";
CREATE INDEX IF NOT EXISTS "items_fabricTypeId_idx" ON "items"("fabricTypeId");
DO $t$ BEGIN ALTER TABLE "items" ADD CONSTRAINT "items_fabricTypeId_fkey" FOREIGN KEY ("fabricTypeId") REFERENCES "fabric_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- Varsayılan tohum (K8/K7) — yönetici Tanımlar'dan ekler/pasife alır; ad zaten varsa dokunulmaz.
INSERT INTO "fabric_types" ("id", "name", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'Tül', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Fon', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Blackout', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Döşemelik', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Stor', 50, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "fiber_types" ("id", "name", "abbreviation", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'Polyester', 'PES', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Pamuk', 'CO', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Viskon', 'VIS', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Keten', 'LI', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Akrilik', 'PAN', 50, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Yün', 'WO', 60, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Naylon', 'PA', 70, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Elastan', 'EL', 80, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Diğer', NULL, 90, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
