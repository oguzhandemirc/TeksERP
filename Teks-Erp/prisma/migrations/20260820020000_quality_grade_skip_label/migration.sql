-- QualityGrade.skipLabel — "bu kalitedeki top otomatik etiket almaz" (2026-08-20)
--
-- Saha isteği: fire kalitede top çıkarılırken etiket basılmasın (varsayılan),
-- fabrika isterse ayardan açsın (`label.scrapGradeLabelEnabled`).
--
-- NEDEN KALİTEDE, STATÜDE DEĞİL: bu kurulumda FİRE kalitesi topu SCRAP'e
-- düşürmüyor — üç kalitenin de targetStatus'ı WAREHOUSE (bilinçli seed kararı).
-- Kuralı statüye bağlasaydık sahada HİÇ tetiklenmezdi.
ALTER TABLE "quality_grades" ADD COLUMN "skipLabel" BOOLEAN NOT NULL DEFAULT false;

-- Mevcut fire kalitesini işaretle. Kod eşleşmesi burada MEŞRU: migration
-- noktasal bir veri ifadesidir (çalışma zamanı kodu koda gömmez, kolonu okur).
-- Fabrika kataloğu yeniden adlandırmışsa satır bulunmaz ve sessizce atlanır —
-- o durumda işaret elle verilir (katalog Electron'da salt-okunur).
UPDATE "quality_grades" SET "skipLabel" = true WHERE "code" = 'FIRE';
