-- Ton grubu (2026-11-23): boyamadan dönen topun ton harfi. Additive, nullable (tablo yeniden yazılmaz).
ALTER TABLE "rolls" ADD COLUMN "shadeCode" VARCHAR(4);

-- Biçim seddi: yalnız ASCII büyük harf/rakam, 1–4 karakter (normalizasyon `shade-group.helper.normalizeShadeCode`).
-- NOT VALID değil: kolon yeni, mevcut satırların hepsi NULL.
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_shade_code_format_chk" CHECK ("shadeCode" IS NULL OR "shadeCode" ~ '^[A-Z0-9]{1,4}$');
