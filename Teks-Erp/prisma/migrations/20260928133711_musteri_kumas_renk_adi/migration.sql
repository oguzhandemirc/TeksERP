-- Müşteri × kumaş × renk adı (docs/design/MUSTERI-KUMAS-RENK-ADI.md §4).
-- Yalnız EKLER: yeni tablo, üretilmiş kolon yok. Mevcut veri etkilenmez. İdempotent (ikinci deploy no-op).
-- (`migrate dev` DEFERRABLE iki FK'yı düşürmek istedi; o satırlar silindi.)

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_item_color_aliases" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "colorId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "customer_item_color_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_item_color_aliases_itemId_idx" ON "customer_item_color_aliases"("itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_item_color_aliases_colorId_idx" ON "customer_item_color_aliases"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customer_item_color_aliases_customerId_itemId_colorId_key" ON "customer_item_color_aliases"("customerId", "itemId", "colorId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_item_color_aliases_customerId_fkey') THEN
    ALTER TABLE "customer_item_color_aliases" ADD CONSTRAINT "customer_item_color_aliases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_item_color_aliases_itemId_fkey') THEN
    ALTER TABLE "customer_item_color_aliases" ADD CONSTRAINT "customer_item_color_aliases_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_item_color_aliases_colorId_fkey') THEN
    ALTER TABLE "customer_item_color_aliases" ADD CONSTRAINT "customer_item_color_aliases_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_item_color_aliases_createdById_fkey') THEN
    ALTER TABLE "customer_item_color_aliases" ADD CONSTRAINT "customer_item_color_aliases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_item_color_aliases_updatedById_fkey') THEN
    ALTER TABLE "customer_item_color_aliases" ADD CONSTRAINT "customer_item_color_aliases_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
