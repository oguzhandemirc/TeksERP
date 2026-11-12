-- =============================================================================
-- Top etiketi elle düzenleme (2026-11-10, panel "Etiketi düzenle").
-- `rolls.labelOverrides` (bind anahtarı → etikete basılan metin; yalnız gösterim),
-- `rolls.labelTemplateId` (bu topun etiketi için bir seferlik şablon, FK label_templates),
-- `rolls.labelEditedAt` (düzenlemenin iyimser sürüm belirteci).
-- ADDITIVE ve idempotent; üç kolon NULL doğar (bugünkü baskı bayt-aynı). Veri göçü yok.
-- rolls büyük tablo: kolon eklemesi metadata-only, index boş kolon üzerinde — yine de zaman aşımı kapatılır.
-- =============================================================================
SET statement_timeout = 0;

ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "labelOverrides" JSONB;
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "labelTemplateId" UUID;
ALTER TABLE "rolls" ADD COLUMN IF NOT EXISTS "labelEditedAt" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "rolls_labelTemplateId_idx" ON "rolls"("labelTemplateId");

DO $f$ BEGIN
  ALTER TABLE "rolls" ADD CONSTRAINT "rolls_labelTemplateId_fkey"
    FOREIGN KEY ("labelTemplateId") REFERENCES "label_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $f$;
