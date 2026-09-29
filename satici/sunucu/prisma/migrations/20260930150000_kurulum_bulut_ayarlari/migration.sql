-- Patron bulutu kurulum ayarları (3bc): eşitleme aralığı (kiraya `esitlemeAraligiDk` olarak basılır) ve
-- buluttaki geçmişin saklama süresi (iç API `saklamaAy`; NULL = tüm geçmiş). Yalnız EKLER; mevcut
-- kurulumlar varsayılanı alır (5 dk · 13 ay) — bugün kira `esitlemeAraligiDk: null` basıyordu ve fabrika
-- bulut hakkı olmadan eşitlemez, yani varsayılan davranışı değiştirmez.
ALTER TABLE "kurulum" ADD COLUMN "esitlemeAraligiDk" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "bulutSaklamaAy" INTEGER DEFAULT 13;

ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_esitleme_araligi" CHECK ("esitlemeAraligiDk" BETWEEN 1 AND 60);
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_bulut_saklama" CHECK ("bulutSaklamaAy" IS NULL OR "bulutSaklamaAy" IN (3, 13, 25));
