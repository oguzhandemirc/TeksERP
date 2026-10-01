-- Lisans v2 · L2-4 — YALNIZ EKLER (yeni kolon/index/CHECK; mevcut satırların anlamı değişmez, kira defteri
-- tetikleyicisi aynen sürer). Önceki migration'ın enum değerlerini (KAPANIS) kullanır, o yüzden ayrı dosya.
--   kurulum.yetenekler      — kurulumun son bildirdiği lisans yetenekleri (yoklama/etkinleştirme yazar)
--   kurulum.sonDurumSirasi  — imzalı durum kaydının son bildirilen sırası (gerilemesi yerel müdahale şüphesi)
--   kira.kapanisNedeni      — yalnız KAPANIS kirasında: KOPYA · TASIMA · IPTAL (K6)
--   kopya_uyarisi.ayrinti   — türe özgü ayrıntı (YEREL_MUDAHALE nedenleri)

ALTER TABLE "kurulum" ADD COLUMN IF NOT EXISTS "yetenekler" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "kurulum" ADD COLUMN IF NOT EXISTS "sonDurumSirasi" INTEGER;

ALTER TABLE "kira" ADD COLUMN IF NOT EXISTS "kapanisNedeni" VARCHAR(10);
DO $kapanis$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kira_kapanis_nedeni') THEN
    ALTER TABLE "kira" ADD CONSTRAINT "kira_kapanis_nedeni" CHECK (
      (("karar" = 'KAPANIS') = ("kapanisNedeni" IS NOT NULL))
      AND ("kapanisNedeni" IS NULL OR "kapanisNedeni" IN ('KOPYA', 'TASIMA', 'IPTAL'))
    );
  END IF;
END
$kapanis$;
-- Kapanış kirasının yeniden kullanımı ve "son başarılı alışveriş" sorusu (anahtar × karar) bu ağaçtan okunur.
CREATE INDEX IF NOT EXISTS "kira_kurulumId_anahtarKimligi_karar_createdAt_idx" ON "kira"("kurulumId", "anahtarKimligi", "karar", "createdAt");

ALTER TABLE "kopya_uyarisi" ADD COLUMN IF NOT EXISTS "ayrinti" JSONB;
