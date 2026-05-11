-- Fason kabul ölçüm alanları kaldırıldı; ölçüm sonraki istasyonun FINISH akışında yapılıyor.

-- AlterTable: receipt başlığında toplam metraj ve fire kolonları düşüyor
ALTER TABLE "subcontractor_receipts"
  DROP COLUMN "totalIncomingQty",
  DROP COLUMN "firingMeters";

-- AlterTable: receipt kalemlerinde per-top ölçüm kolonları düşüyor, yerine not kolonu ekleniyor
ALTER TABLE "subcontractor_receipt_items"
  DROP COLUMN "incomingQty",
  DROP COLUMN "incomingWeight",
  ADD COLUMN "notes" TEXT;
