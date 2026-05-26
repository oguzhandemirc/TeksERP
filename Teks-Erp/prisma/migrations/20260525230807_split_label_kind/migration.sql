-- LabelKind enum'unu ROLL → ROLL_RAW + ROLL_FINISHED olarak böl.
-- Mevcut ROLL kayıtları semantik olarak Tambur etiketi (renkli/müşteri alanlı) idi,
-- ROLL_FINISHED'a taşınır. ROLL_RAW yeni kategori — seed/default şablonu Electron'da
-- veya seed.ts'te oluşturulur.

-- 1) Column'u geçici olarak TEXT'e al (eski enum referansını kaldır)
ALTER TABLE "label_templates" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "label_templates" ALTER COLUMN "kind" TYPE TEXT;

-- 2) Eski 'ROLL' → 'ROLL_FINISHED' map
UPDATE "label_templates" SET "kind" = 'ROLL_FINISHED' WHERE "kind" = 'ROLL';

-- 3) Eski enum tipini bırak
DROP TYPE "LabelKind";

-- 4) Yeni enum oluştur
CREATE TYPE "LabelKind" AS ENUM ('ROLL_RAW', 'ROLL_FINISHED', 'SWATCH');

-- 5) Column'u yeni enum'a geri al
ALTER TABLE "label_templates" ALTER COLUMN "kind" TYPE "LabelKind" USING "kind"::"LabelKind";
