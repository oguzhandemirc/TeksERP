-- =============================================================================
-- Devere Faz 2 — İPLİK LOTU (DEVERE-LEVENT-TARAMASI §3.5 / §4): `yarn_lots` + `yarn_movements.lotId/bobbinCount`
-- =============================================================================
-- Lot bakiyesi AYRI TABLOYA İNMEZ (türetilir); `yarn_stocks` değişmez. Mevcut hareketler
-- lotsuz kalır — VERİ MİGRASYONU YOK (lot izlemesinden önce giren iplik lotsuzdur, çıkabilir).
-- İDEMPOTENT ([DB-23]): ikinci koşum hata vermez, nesne kümesi sabit kalır.
-- GÜVENLİ: yalnız EKLEME (tablo + nullable kolonlar + indeks + CHECK).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "yarn_lots" (
  "id"          uuid         NOT NULL,
  "itemId"      uuid         NOT NULL,
  "lotNo"       varchar(64)  NOT NULL,
  "supplierId"  uuid,
  "notes"       varchar(300),
  "isActive"    boolean      NOT NULL DEFAULT true,
  "createdAt"   timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz  NOT NULL,
  "createdById" uuid,
  "updatedById" uuid,
  CONSTRAINT "yarn_lots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "yarn_lots_itemId_lotNo_key" ON "yarn_lots" ("itemId", "lotNo");
CREATE INDEX IF NOT EXISTS "yarn_lots_supplierId_idx" ON "yarn_lots" ("supplierId");

DO $$ BEGIN
  ALTER TABLE "yarn_lots"
    ADD CONSTRAINT "yarn_lots_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "yarn_lots"
    ADD CONSTRAINT "yarn_lots_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- İplik defteri: lot bağı (nullable) + bobin adedi (bilgi).
ALTER TABLE "yarn_movements" ADD COLUMN IF NOT EXISTS "lotId" uuid;
ALTER TABLE "yarn_movements" ADD COLUMN IF NOT EXISTS "bobbinCount" integer;
CREATE INDEX IF NOT EXISTS "yarn_movements_lotId_createdAt_idx" ON "yarn_movements" ("lotId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "yarn_movements"
    ADD CONSTRAINT "yarn_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "yarn_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_bobbin_positive" CHECK (
    "bobbinCount" IS NULL OR "bobbinCount" > 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
