-- =============================================================================
-- 2026-10-24 — Station.defaultLabelCopies: istasyonun VARSAYILAN etiket adedi
-- ADDITIVE · idempotent · nullable — mevcut satır değişmez (NULL = genel adet `label.copies`).
-- Yalnız `label.copiesSource = STATION` iken okunur; varsayılan kaynak GLOBAL = bugünkü davranış.
-- CHECK `stations_default_label_copies_range`: 1–5 (akış etiketi tavanı `LABEL_COPIES_MAX`).
-- `--create-only` çıktısındaki iki DEFERRABLE composite FK DropForeignKey satırı SİLİNDİ ([DB-21]).
-- =============================================================================

-- AlterTable
ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "defaultLabelCopies" INTEGER;

-- CHECK seddi (BaseController yazma yolunda Zod yok — servis doğrular, DB son kapı)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stations_default_label_copies_range') THEN
    ALTER TABLE "stations" ADD CONSTRAINT "stations_default_label_copies_range"
      CHECK ("defaultLabelCopies" IS NULL OR ("defaultLabelCopies" BETWEEN 1 AND 5));
  END IF;
END $$;
