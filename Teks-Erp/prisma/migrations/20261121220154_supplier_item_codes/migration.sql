-- Seyitoğlu d5 (2026-11-22): tedarikçi kalem kodu ↔ iplik kartı eşlemesi.
-- YALNIZ EKLEME: yeni tablo `supplier_item_codes` + `yarn_movements.supplierItemCode` (nullable iz kolonu).
-- Var olan satıra dokunulmaz; geriye dönük NULL. DropForeignKey satırları (DEFERRABLE FK'lar) silindi.

-- AlterTable
ALTER TABLE "yarn_movements" ADD COLUMN IF NOT EXISTS "supplierItemCode" VARCHAR(64);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supplier_item_codes" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "codeKey" VARCHAR(64) NOT NULL,
    "rawCode" VARCHAR(64) NOT NULL,
    "itemId" UUID NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "supplier_item_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supplier_item_codes_itemId_idx" ON "supplier_item_codes"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_item_codes_supplierId_codeKey_key" ON "supplier_item_codes"("supplierId", "codeKey");

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_item_codes_supplierId_fkey') THEN
    ALTER TABLE "supplier_item_codes" ADD CONSTRAINT "supplier_item_codes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_item_codes_itemId_fkey') THEN
    ALTER TABLE "supplier_item_codes" ADD CONSTRAINT "supplier_item_codes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $fk$;
