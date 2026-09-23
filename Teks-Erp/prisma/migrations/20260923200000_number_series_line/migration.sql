-- NUMARA SERİSİ BİÇİM SATIRI — biçim bir DEĞER değil ZAMAN ÇİZGİSİ (2026-09-23)
-- YALNIZ EKLER (ADDITIVE): bir tablo + iki indeks + bir FK. Hiçbir kolon düşmez,
-- hiçbir satır güncellenmez. `number_series` üzerindeki biçim kolonları KALIR ve
-- bu fazda yürürlükteki satırdan türetilen bir ÖNBELLEK olur (tek yazar ikisini
-- aynı tx'te yazar) — kaldırma AYRI bir fazdır.
--
-- ⚠️ SATIRLARI BU MIGRATION YAZMAZ: göç, kod tarafında TEK SEFERLİK ve DAMGALI
-- koşar (`number-series-catalog.job`), çünkü `number_series` satırlarını boot
-- uzlaştırması yaratıyor — migration anında seri satırı HENÜZ YOK olabilir ve
-- buradaki bir INSERT … SELECT sessizce hiçbir şey yazmazdı. Bu depoda aynı
-- tuzak "WHERE EXISTS no-op" olarak yaşandı.

CREATE TABLE IF NOT EXISTS "number_series_lines" (
    "id"            UUID NOT NULL,
    "seriesKey"     VARCHAR(64) NOT NULL,
    "prefix"        VARCHAR(6) NOT NULL,
    "dateSegment"   "NumberSeriesDateSegment" NOT NULL,
    "digits"        INTEGER NOT NULL DEFAULT 4,
    "separator"     VARCHAR(2) NOT NULL DEFAULT '',
    "effectiveFrom" TIMESTAMPTZ NOT NULL,
    "isSentinel"    BOOLEAN NOT NULL DEFAULT false,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ NOT NULL,

    CONSTRAINT "number_series_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "number_series_lines_seriesKey_effectiveFrom_key"
    ON "number_series_lines"("seriesKey", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "number_series_lines_seriesKey_effectiveFrom_idx"
    ON "number_series_lines"("seriesKey", "effectiveFrom");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_series_lines_seriesKey_fkey') THEN
    ALTER TABLE "number_series_lines" ADD CONSTRAINT "number_series_lines_seriesKey_fkey"
      FOREIGN KEY ("seriesKey") REFERENCES "number_series"("key") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Hane sedi, `number_series` ile AYNI: 1 = dolgusuz, 8 = pratik tavan.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_series_lines_digits_range') THEN
    ALTER TABLE "number_series_lines" ADD CONSTRAINT "number_series_lines_digits_range"
      CHECK ("digits" >= 1 AND "digits" <= 8);
  END IF;
END $$;
