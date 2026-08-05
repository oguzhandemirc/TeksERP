-- =============================================================================
-- Ölü etiket sorunu — topun kendi satırında etiket + iptal izi
-- =============================================================================
-- Saha vakası (2026-08-05): T050826H0033 10:48:30'da basıldı, 10:56:02'de KK1
-- operatörü tarafından iptal edildi. Kâğıt topun üstünde kaldı; aynı fiziksel top
-- saatler sonra ikinci bir barkodla (T050826H0072) yeniden kaydedilip boyahaneye
-- gitti. Üç boşluk birden: iptal etiketin basıldığına bakmıyordu, iptalin geri
-- alınması yoktu, okutma yüzeyi sebebi söylemiyordu.
--
-- Beş kolon da NULLABLE ve DEFAULT'suz → PG11+'ta metadata-only, tablo yeniden
-- yazılmaz (`rolls` canlıda dolu). "Canlı tabloya kolon eklemek pahalı" sezgisi
-- DEFAULT'lu kolonlar içindir; ikisi karıştırılıp kolon yerine JSON seçilmemeli.
--
-- `preCancelStatus` = `preShipStatus` emsali: geri almada körlemesine STOCK'a
-- dönmek A1_STOCK/WAREHOUSE topunu sessizce yanlış rafa yazardı.
-- =============================================================================

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "cancelReason" VARCHAR(500),
ADD COLUMN     "cancelledAt" TIMESTAMPTZ,
ADD COLUMN     "cancelledById" UUID,
ADD COLUMN     "labelPrintedAt" TIMESTAMPTZ,
ADD COLUMN     "preCancelStatus" "RollStatus";

-- AddForeignKey
-- Index BİLİNÇLİ EKLENMEDİ: düşük-trafik "kim yaptı" audit FK'sı (perf kuralı 1'in
-- yazılı istisnası — printedById/grantedById/updatedById emsali) ve `rolls` zaten
-- en çok indeksli tablo.
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
