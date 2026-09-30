-- Bildirim GİDEN KUTUSU (outbox): satıcı olayı kendi tx'inde satır yazar; gönderimi çıkışı olan yan konteyner
-- (`satici-bildirim`) yapar. Üç bölüm: ① tablo (Prisma) · ② CHECK'ler + gövde ALLOWLIST seddi · ③ en az yetkili
-- gönderici rolü `satici_bildirim` (YALNIZ bu tabloda SELECT + durum kolonlarında UPDATE).

-- CreateEnum
CREATE TYPE "BildirimOlayi" AS ENUM ('DESTEK_TALEBI', 'KOPYA_SUPHESI', 'KOPYA_KIRA_REDDI', 'TASIMA_TALEBI', 'DR_DEVRI', 'KURULUM_SESSIZ', 'KIRA_BITISI_YAKLASIYOR', 'GECERLILIK_BITISI_YAKLASIYOR', 'TAKSIT_VADESI_YAKLASIYOR', 'PLANLI_EYLEM_UYGULANDI', 'TAKSIT_GECIKTI', 'DENEME');

-- CreateEnum
CREATE TYPE "BildirimKanali" AS ENUM ('EPOSTA', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "BildirimDurumu" AS ENUM ('BEKLIYOR', 'GONDERILIYOR', 'GONDERILDI', 'HATA', 'KAPALI');

-- CreateTable
CREATE TABLE "bildirim" (
    "id" UUID NOT NULL,
    "olay" "BildirimOlayi" NOT NULL,
    "kanal" "BildirimKanali" NOT NULL,
    "tekillikAnahtari" VARCHAR(200) NOT NULL,
    "kurulumId" UUID,
    "ilgiliKayit" UUID,
    "govde" JSONB NOT NULL,
    "durum" "BildirimDurumu" NOT NULL DEFAULT 'BEKLIYOR',
    "deneme" INTEGER NOT NULL DEFAULT 0,
    "sonrakiDeneme" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kilitBitis" TIMESTAMPTZ,
    "sonHata" VARCHAR(80),
    "saglayiciKimligi" VARCHAR(100),
    "gonderimZamani" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bildirim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bildirim_durum_sonrakiDeneme_idx" ON "bildirim"("durum", "sonrakiDeneme");

-- CreateIndex
CREATE INDEX "bildirim_kanal_updatedAt_idx" ON "bildirim"("kanal", "updatedAt");

-- CreateIndex
CREATE INDEX "bildirim_createdAt_idx" ON "bildirim"("createdAt");

-- CreateIndex
CREATE INDEX "bildirim_kurulumId_idx" ON "bildirim"("kurulumId");

-- CreateIndex
CREATE UNIQUE INDEX "bildirim_tekillikAnahtari_kanal_key" ON "bildirim"("tekillikAnahtari", "kanal");

-- AddForeignKey
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_kurulumId_fkey" FOREIGN KEY ("kurulumId") REFERENCES "kurulum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ② Çift yüklemler + biçim seddi (sonHata yalnız kısa KOD: ham sağlayıcı yanıtı, başlık, sır giremez).
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_deneme_negatif_degil" CHECK ("deneme" >= 0);
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_gonderim_ciftli" CHECK (("durum" = 'GONDERILDI') = ("gonderimZamani" IS NOT NULL));
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_kilit_ciftli" CHECK (("durum" = 'GONDERILIYOR') = ("kilitBitis" IS NOT NULL));
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_hata_kodlu" CHECK ("durum" NOT IN ('HATA', 'KAPALI') OR "sonHata" IS NOT NULL);
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_hata_kodu_bicimi" CHECK ("sonHata" IS NULL OR "sonHata" ~ '^[A-Z0-9_]{1,80}$');
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_saglayici_kimligi_bicimi" CHECK ("saglayiciKimligi" IS NULL OR "saglayiciKimligi" ~ '^[A-Za-z0-9_.:-]{1,100}$');
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_anahtar_bicimi" CHECK ("tekillikAnahtari" ~ '^[A-Z_]{2,40}:[A-Za-z0-9:._-]{1,150}$');

-- Gövde ALLOWLIST seddi — kodun kurucusuyla (src/notifications/catalog.ts `NOTIFICATION_BODY_KEYS`) aynı liste; bekçi
-- ikisini ölçer. Yalnız beyanlı anahtar, her değer metin ya da null, metin ≤ 300 karakter, gövde ≤ 2000 bayt; portal
-- yolu zorunlu ve yalnız göreli yol (dış adres, betik şeması giremez). Talep metni/ek/sağlık için anahtar YOKTUR.
CREATE FUNCTION "bildirim_govde_gecerli"(g jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(g) = 'object'
     AND octet_length(g::text) <= 2000
     AND jsonb_typeof(g -> 'portalYolu') = 'string'
     AND (g ->> 'portalYolu') ~ '^/[a-z0-9/-]{0,200}$'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(g) AS e(k, v)
        WHERE e.k <> ALL (ARRAY['musteri', 'tesis', 'kurulum', 'lisansNo', 'sinif', 'konu', 'referans', 'tarih', 'portalYolu'])
           OR jsonb_typeof(e.v) NOT IN ('string', 'null')
           OR (jsonb_typeof(e.v) = 'string' AND char_length(e.v #>> '{}') > 300)
     )
$$;
ALTER TABLE "bildirim" ADD CONSTRAINT "bildirim_govde_allowlist" CHECK ("bildirim_govde_gecerli"("govde"));

-- ③ En az yetkili gönderici rolü. Rol KÜME düzeyindedir: yoksa NOLOGIN doğar (parola + LOGIN kurulumda
-- `node dist/notifications/role-cli.js`, parola stdin'den, SCRAM doğrulayıcısı istemcide kurulur); varsa
-- özniteliklerine dokunulmaz. Yetki bu DB'de sıfırdan verilir; sonraki göçlerin yeni tabloları bu role HİÇBİR
-- şey vermez (varsayılan yetki yok → fail-closed). Bekçi: test_bildirim_rolu (her tablo × her yetki ölçülür).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satici_bildirim') THEN
    CREATE ROLE "satici_bildirim" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "satici_bildirim";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "satici_bildirim";
GRANT USAGE ON SCHEMA public TO "satici_bildirim";
GRANT SELECT ON "bildirim" TO "satici_bildirim";
GRANT UPDATE ("durum", "deneme", "sonrakiDeneme", "kilitBitis", "sonHata", "saglayiciKimligi", "gonderimZamani", "updatedAt") ON "bildirim" TO "satici_bildirim";
