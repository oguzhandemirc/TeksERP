-- K6 (Seyitoğlu 2026-11-25): atkı ipliği satırına tezgâh renk seçicisi kanalı — yalnız EKLEME.
-- Eski satırlar NULL alır (= belirtilmemiş, bugünkü görünüm); veri dönüştürülmez.
ALTER TABLE "weft_spec_yarns" ADD COLUMN "colorChannel" SMALLINT;

-- Kanal no 1..16 (rapier renk seçicilerinin yaygın üst sınırı; servis `WEFT_COLOR_CHANNEL_MAX` ikizi).
ALTER TABLE "weft_spec_yarns" ADD CONSTRAINT "weft_spec_yarns_color_channel_ck"
  CHECK ("colorChannel" IS NULL OR "colorChannel" BETWEEN 1 AND 16);

-- Aynı kartta iki satır aynı kanalı kullanamaz (servis 400 WEFT_CHANNEL_DUPLICATE ikizi); NULL'lar çakışmaz.
CREATE UNIQUE INDEX "weft_spec_yarns_weftSpecId_colorChannel_key" ON "weft_spec_yarns"("weftSpecId", "colorChannel");
