-- Çuval "sil" DURUM GEÇİŞİ (2026-11-19): tahsis defteri (sack_allocations) taşıyan boş havuz çuvalı
-- sert silinmez, damgalanır. Yalnız EKLEME: iki kolon + index + FK + CHECK (mevcut satırların hepsi
-- retiredAt NULL doğar, CHECK eski veride boş geçer).

-- AlterTable
ALTER TABLE "sacks" ADD COLUMN     "retiredAt" TIMESTAMPTZ,
ADD COLUMN     "retiredById" UUID;

-- CreateIndex
CREATE INDEX "sacks_retiredById_idx" ON "sacks"("retiredById");

-- AddForeignKey
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_retiredById_fkey" FOREIGN KEY ("retiredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Emekli çuval havuzdadır, SACK türündedir ve gruptan düşmüştür (sevkiyata/gruba geri bağlanamaz).
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_retired_shape" CHECK (
  "retiredAt" IS NULL
  OR ("shipmentId" IS NULL AND "unitKind" = 'SACK' AND "packingGroupId" IS NULL AND "packageNo" IS NULL)
);
