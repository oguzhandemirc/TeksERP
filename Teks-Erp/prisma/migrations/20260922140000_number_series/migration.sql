-- NUMBER SERIES — insan-okur numara/kod biçimi veri olur (2026-09-22)
-- Yalnız EKLER: tablo + enum. Mevcut kodlara ve üretim yoluna dokunmaz; tohum
-- satırları boot uzlaştırması (number-series-catalog.job) yazar, bu yüzden burada
-- INSERT yok — koddaki katalog tek kaynak, migration yalnız kabı açar.

CREATE TYPE "NumberSeriesDateSegment" AS ENUM ('NONE', 'DDMMYY', 'YYMM', 'YYYYMM', 'YY', 'YYYY');

CREATE TABLE "number_series" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "prefix" VARCHAR(6) NOT NULL,
    "dateSegment" "NumberSeriesDateSegment" NOT NULL,
    "digits" INTEGER NOT NULL DEFAULT 4,
    "separator" VARCHAR(2) NOT NULL DEFAULT '',
    "retiredPrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scanned" BOOLEAN NOT NULL DEFAULT false,
    "editable" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "number_series_key_key" ON "number_series"("key");
CREATE INDEX "number_series_updatedById_idx" ON "number_series"("updatedById");

ALTER TABLE "number_series" ADD CONSTRAINT "number_series_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hane sayısı sedde bağlı: 1 = dolgusuz, 8 = pratik tavan (VarChar(64) kolonlar).
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_digits_range"
    CHECK ("digits" >= 1 AND "digits" <= 8);
