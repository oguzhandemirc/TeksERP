-- Faz 3: Roll.qualityGrade NULLABLE. Kaliteyi yalnız kalite istasyonları belirler;
-- kaliteye bakılmamış top (açık kumaş / fason dönüşü / kalitesiz giriş) NULL kalır.
-- Girişteki sessiz "1.KALITE" default'u kalkar (kod tarafı). Mevcut satırlar dolu kalır.

ALTER TABLE "rolls" ALTER COLUMN "qualityGrade" DROP NOT NULL;
