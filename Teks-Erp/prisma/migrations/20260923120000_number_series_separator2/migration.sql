-- TARİH ile SAYAÇ arasındaki ikinci ayraç (D5②).
--
-- YALNIZ EKLER: iki kolon da NULL kabul eder ve NULL = "separator'a düş",
-- yani var olan 52 serinin ürettiği kod bayt bayt aynı kalır. Varsayılan
-- DEĞER KONMAZ — "" koysaydık, ayracı "-" olan bir seri sessizce
-- `PRT-26090001` üretmeye başlardı.
ALTER TABLE "number_series" ADD COLUMN IF NOT EXISTS "separator2" VARCHAR(2);
ALTER TABLE "number_series_lines" ADD COLUMN IF NOT EXISTS "separator2" VARCHAR(2);
