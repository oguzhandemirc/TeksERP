-- MAL-4: gün-yalnız teklif/liste kolonları `…Date` soneki alır. `validFrom`/`validUntil` adları başka modellerde
-- timestamptz; `DATE_ONLY_COLUMNS` (query-parser) ad bazlı olduğundan aynı ad iki tipte olamaz. Veri taşınmaz (RENAME).
ALTER TABLE "sales_quotes" RENAME COLUMN "validUntil" TO "validUntilDate";
ALTER INDEX "sales_quotes_status_validUntil_idx" RENAME TO "sales_quotes_status_validUntilDate_idx";
ALTER TABLE "price_lists" RENAME COLUMN "validFrom" TO "validFromDate";
ALTER TABLE "price_lists" RENAME COLUMN "validUntil" TO "validUntilDate";
