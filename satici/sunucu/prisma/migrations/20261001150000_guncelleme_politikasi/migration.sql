-- Dağıtım v2 (D1): kurulum başına backend güncelleme politikası + fabrikanın güncelleme raporu.
-- Yalnız EKLER; mevcut kurulumlar ONAYLI · pencere yok · sabitleme yok alır = bugünkü davranış (kendiliğinden
-- hiçbir şey kurulmaz). Politika kiraya `guncelleme` alanıyla ALT imzalı basılır; değişimi `kurulum_kaydi`nda.
CREATE TYPE "GuncellemeKipi" AS ENUM ('OTOMATIK', 'ONAYLI', 'DONDUR');

ALTER TABLE "kurulum" ADD COLUMN "guncellemeKipi" "GuncellemeKipi" NOT NULL DEFAULT 'ONAYLI',
ADD COLUMN "guncellemePencereBaslangic" VARCHAR(5),
ADD COLUMN "guncellemePencereBitis" VARCHAR(5),
ADD COLUMN "guncellemePencereGunleri" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "guncellemeHedefSurum" VARCHAR(40),
ADD COLUMN "saatDilimi" VARCHAR(64),
ADD COLUMN "sonGuncellemeRaporu" JSONB,
ADD COLUMN "sonGuncellemeRaporuZamani" TIMESTAMPTZ;

-- Pencere üç alanıyla birlikte ya tamamen boş ya tamamen dolu; OTOMATİK kip pencere ister (protokol şemasıyla aynı kural).
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_guncelleme_penceresi" CHECK (
  ("guncellemePencereBaslangic" IS NULL AND "guncellemePencereBitis" IS NULL AND cardinality("guncellemePencereGunleri") = 0)
  OR ("guncellemePencereBaslangic" IS NOT NULL AND "guncellemePencereBitis" IS NOT NULL
      AND cardinality("guncellemePencereGunleri") BETWEEN 1 AND 7
      AND "guncellemePencereGunleri" <@ ARRAY[1, 2, 3, 4, 5, 6, 7])
);
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_guncelleme_otomatik_pencere" CHECK (
  "guncellemeKipi" <> 'OTOMATIK' OR "guncellemePencereBaslangic" IS NOT NULL
);
