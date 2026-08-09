-- NOT: üretilen dosyadaki iki DropForeignKey satırı ELLE SİLİNDİ
-- (rolls/swatches composite FK'ları datamodel'de temsil edilemiyor → her diff'te
-- spurious DROP üretiyorlar). Kural: schema.prisma:2557-2558.

-- `Roll.labelCustomerId` — etiketinde yazan müşteri; SAHİPLİK DEĞİL, basılmış
-- kâğıdın izi. Nullable → metadata-only, tablo yeniden yazılmaz.
-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "labelCustomerId" UUID;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_labelCustomerId_fkey" FOREIGN KEY ("labelCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK index (perf kuralı 1). PARTIAL: kolon çoğunlukla NULL olacak (stok etiketi
-- bilinçli bir seçimdir ve yaygındır) — tam index tablonun tamamını taşırdı.
-- Sorgu yolu her zaman "şu müşterinin topları", yani NULL satırlar hiç aranmaz.
-- ⚠️ Şema-dışı nesne → `scripts/test_db_invariants.ts` envanterine EKLENDİ.
CREATE INDEX "rolls_labelCustomerId_idx" ON "rolls"("labelCustomerId") WHERE "labelCustomerId" IS NOT NULL;
