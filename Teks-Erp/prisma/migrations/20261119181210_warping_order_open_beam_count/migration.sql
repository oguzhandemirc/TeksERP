-- Fason devere: "levent adedi belli değil" — sipariş yalnız toplam metreyle açılabilir (adet kabulde çıkar).
-- Yalnız GEVŞETME: mevcut satırların hepsi dolu; CHECK "beamCount" > 0 kalır (NULL geçer).

-- AlterTable
ALTER TABLE "warping_orders" ALTER COLUMN "beamCount" DROP NOT NULL;
