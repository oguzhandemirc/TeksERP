-- Hata raporu kanalı (müşteri onaylı, kişisel verisiz): grup + gönderim partisi. İkisi de TELEMETRİ
-- (saklama günü dolunca budanır); mevcut tablolara dokunmaz, yalnız ekler.
CREATE TABLE "hata_raporu_grubu" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "grupAnahtari" CHAR(64) NOT NULL,
    "kaynak" VARCHAR(10) NOT NULL,
    "surum" VARCHAR(60) NOT NULL,
    "kod" VARCHAR(60) NOT NULL,
    "sinif" VARCHAR(60) NOT NULL,
    "bilesen" VARCHAR(40) NOT NULL,
    "yol" VARCHAR(200),
    "yigin" VARCHAR(160)[],
    "sayi" INTEGER NOT NULL,
    "ilk" TIMESTAMPTZ NOT NULL,
    "son" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hata_raporu_grubu_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hata_raporu_grubu_sayi_check" CHECK ("sayi" >= 1)
);

CREATE TABLE "hata_raporu_partisi" (
    "id" UUID NOT NULL,
    "kurulumId" UUID NOT NULL,
    "partiId" UUID NOT NULL,
    "kayitSayisi" INTEGER NOT NULL,
    "kabul" INTEGER NOT NULL,
    "dusurulen" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hata_raporu_partisi_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hata_raporu_grubu_kurulumId_grupAnahtari_key" ON "hata_raporu_grubu"("kurulumId", "grupAnahtari");
CREATE INDEX "hata_raporu_grubu_kurulumId_son_idx" ON "hata_raporu_grubu"("kurulumId", "son");
CREATE INDEX "hata_raporu_grubu_son_idx" ON "hata_raporu_grubu"("son");
CREATE UNIQUE INDEX "hata_raporu_partisi_kurulumId_partiId_key" ON "hata_raporu_partisi"("kurulumId", "partiId");
CREATE INDEX "hata_raporu_partisi_createdAt_idx" ON "hata_raporu_partisi"("createdAt");

ALTER TABLE "hata_raporu_grubu" ADD CONSTRAINT "hata_raporu_grubu_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hata_raporu_partisi" ADD CONSTRAINT "hata_raporu_partisi_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
