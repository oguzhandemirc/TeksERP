-- Perf-4 B-03 — kendi sayaç satırı olan seri (bugün `doffEvent`). ADDITIVE: yeni tablo, veri göçü YOK.
-- Satırlar ilk kullanımda mevcut kodların max'ından atomik tohumlanır (INSERT … ON CONFLICT DO NOTHING);
-- mevcut numaralar ve geçmiş etkilenmez. `DropForeignKey` satırları (DEFERRABLE FK'lar) bilinçli silindi.
CREATE TABLE IF NOT EXISTS "number_series_counters" (
    "id" UUID NOT NULL,
    "seriesKey" VARCHAR(64) NOT NULL,
    "scopeKey" VARCHAR(200) NOT NULL,
    "n" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "number_series_counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "number_series_counters_seriesKey_scopeKey_key" ON "number_series_counters"("seriesKey", "scopeKey");
