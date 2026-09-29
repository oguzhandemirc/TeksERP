-- Faz 2d (modül şifreleme): kurulumun X25519 açık anahtarı + modül anahtarı kasası. Yalnız EKLER;
-- mevcut satırın anlamı değişmez (eski kurulum ilk yoklamada anahtarını bildirir).

-- Kurulumun X25519 açık anahtarı (base64url 43 karakter).
ALTER TABLE "kurulum" ADD COLUMN "sifrelemeAnahtari" VARCHAR(64);
ALTER TABLE "kurulum" ADD CONSTRAINT "kurulum_sifreleme_anahtari_bicim"
  CHECK ("sifrelemeAnahtari" IS NULL OR "sifrelemeAnahtari" ~ '^[A-Za-z0-9_-]{43}$');

-- Modül anahtarı kasası: anahtar kasa anahtarıyla sarılı (düz anahtar DB'de YOK).
CREATE TABLE "modul_anahtari" (
    "id" UUID NOT NULL,
    "modul" VARCHAR(64) NOT NULL,
    "surum" INTEGER NOT NULL,
    "kid" VARCHAR(40) NOT NULL,
    "sarili" VARCHAR(200) NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "yapan" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "modul_anahtari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "modul_anahtari_kid_key" ON "modul_anahtari"("kid");
CREATE UNIQUE INDEX "modul_anahtari_modul_surum_key" ON "modul_anahtari"("modul", "surum");
ALTER TABLE "modul_anahtari" ADD CONSTRAINT "modul_anahtari_surum_pozitif" CHECK ("surum" >= 1);
ALTER TABLE "modul_anahtari" ADD CONSTRAINT "modul_anahtari_kid_bicim" CHECK ("kid" ~ '^mk-[A-Za-z0-9_-]{22}$');
-- Kasa satırı silinmez (emeklilik aktif=false); anahtar ve kimliği değişmez.
CREATE FUNCTION "modul_anahtari_degismez"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'modul_anahtari silinmez (emeklilik aktif=false)';
  END IF;
  IF NEW."modul" <> OLD."modul" OR NEW."surum" <> OLD."surum" OR NEW."kid" <> OLD."kid" OR NEW."sarili" <> OLD."sarili" THEN
    RAISE EXCEPTION 'modul_anahtari anahtarı değiştirilemez';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "modul_anahtari_koru" BEFORE UPDATE OR DELETE ON "modul_anahtari" FOR EACH ROW EXECUTE FUNCTION "modul_anahtari_degismez"();
