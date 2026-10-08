-- GÜNCELLEME DALGASI (F1a — docs/design/GUNCELLEYICI-SAGLAMLIK.md §6.2): grup içinde kademeli backend yayılımı, aşamalar
-- ELLE (AK-2). ADDITIVE: iki yeni tablo + bir bildirim olayı. Mevcut tablolara ve satırlara DOKUNMAZ; dalga satırı yokken
-- kira bugünkü gibi basılır (tavan yok). `guncelleme_dalgasi.asama` DURUM, `guncelleme_dalgasi_kaydi` DEFTER (tetikleyici).

ALTER TYPE "BildirimOlayi" ADD VALUE IF NOT EXISTS 'GUNCELLEME_DALGA_UYARI';

CREATE TABLE "guncelleme_dalgasi" (
    "id" UUID NOT NULL,
    "kanalKodu" VARCHAR(40) NOT NULL,
    "surum" VARCHAR(40) NOT NULL,
    "oncekiSurum" VARCHAR(40) NOT NULL,
    "asama" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "guncelleme_dalgasi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "guncelleme_dalgasi_asama_aralik" CHECK ("asama" BETWEEN 0 AND 3),
    CONSTRAINT "guncelleme_dalgasi_onceki_farkli" CHECK ("oncekiSurum" <> "surum")
);

CREATE TABLE "guncelleme_dalgasi_kaydi" (
    "id" UUID NOT NULL,
    "dalgaId" UUID NOT NULL,
    "olay" VARCHAR(30) NOT NULL,
    "oncekiAsama" INTEGER,
    "yeniAsama" INTEGER NOT NULL,
    "sebep" VARCHAR(500) NOT NULL,
    "ekOnay" BOOLEAN NOT NULL DEFAULT false,
    "ayrinti" JSONB,
    "yapan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guncelleme_dalgasi_kaydi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "guncelleme_dalgasi_kaydi_sebep_dolu" CHECK (char_length(btrim("sebep")) > 0),
    CONSTRAINT "guncelleme_dalgasi_kaydi_asama_aralik" CHECK ("yeniAsama" BETWEEN 0 AND 3 AND ("oncekiAsama" IS NULL OR "oncekiAsama" BETWEEN 0 AND 3)),
    -- Olay ↔ aşama yönü: açılış durdu (0) doğar; ilerletme TEK adım; geri çekme aşağı (bir ya da birden çok adım).
    CONSTRAINT "guncelleme_dalgasi_kaydi_olay_yonu" CHECK (
        ("olay" = 'DALGA_ACILDI' AND "oncekiAsama" IS NULL AND "yeniAsama" = 0 AND NOT "ekOnay")
        OR ("olay" = 'ASAMA_ILERLETILDI' AND "oncekiAsama" IS NOT NULL AND "yeniAsama" = "oncekiAsama" + 1)
        OR ("olay" = 'ASAMA_GERI_CEKILDI' AND "oncekiAsama" IS NOT NULL AND "yeniAsama" < "oncekiAsama" AND NOT "ekOnay")
    )
);

CREATE UNIQUE INDEX "guncelleme_dalgasi_kanalKodu_surum_key" ON "guncelleme_dalgasi"("kanalKodu", "surum");
CREATE INDEX "guncelleme_dalgasi_kaydi_dalgaId_createdAt_idx" ON "guncelleme_dalgasi_kaydi"("dalgaId", "createdAt");

ALTER TABLE "guncelleme_dalgasi" ADD CONSTRAINT "guncelleme_dalgasi_kanalKodu_fkey" FOREIGN KEY ("kanalKodu") REFERENCES "kanal"("kod") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "guncelleme_dalgasi_kaydi" ADD CONSTRAINT "guncelleme_dalgasi_kaydi_dalgaId_fkey" FOREIGN KEY ("dalgaId") REFERENCES "guncelleme_dalgasi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "guncelleme_dalgasi_kaydi_defter" BEFORE UPDATE OR DELETE ON "guncelleme_dalgasi_kaydi" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
