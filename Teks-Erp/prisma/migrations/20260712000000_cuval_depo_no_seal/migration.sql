-- Çuval Depo modeli: mühür (sealedAt) + rezerv (packedQty) KALDIRILDI; çuval müşterisi nullable.
-- Veri kaybı bilinçli (hepsi test verisi): dolu sealedAt/packedQty kolonları düşürülür.
-- Sipariş görünümü artık İstenen | Sevk | Açık; düşüş yalnız sevkte (SackAllocation sevk-anı yazılır).

-- 1) Rezerv kolonları (packedQty) — OrderLine + Order
ALTER TABLE "order_lines" DROP COLUMN IF EXISTS "packedQty";
ALTER TABLE "orders"      DROP COLUMN IF EXISTS "packedQty";

-- 2) Mühür izi (sealedAt/sealedById) — önce FK, sonra index, sonra kolonlar
ALTER TABLE "sacks" DROP CONSTRAINT IF EXISTS "sacks_sealedById_fkey";
DROP INDEX IF EXISTS "sacks_customerId_sealedAt_idx";
ALTER TABLE "sacks" DROP COLUMN IF EXISTS "sealedAt";
ALTER TABLE "sacks" DROP COLUMN IF EXISTS "sealedById";

-- 3) Çuval müşterisi opsiyonel (depoda genel stok çuvalı da olabilir; müşteri sevkte atanır)
ALTER TABLE "sacks" ALTER COLUMN "customerId" DROP NOT NULL;

-- 4) Havuz/liste index'i: müşteri + oluşturma sırası (FIFO = createdAt, eski sealedAt yerine)
CREATE INDEX "sacks_customerId_createdAt_idx" ON "sacks" ("customerId", "createdAt");
