-- Kenar-başına pay (mm). Nullable → boş bırakılırsa eski tek marginMm'e düşülür
-- (resolver'da `?? marginMm`), böylece mevcut profiller aynen davranır.
ALTER TABLE "label_format_profiles" ADD COLUMN "marginTopMm"    DECIMAL(5,2);
ALTER TABLE "label_format_profiles" ADD COLUMN "marginRightMm"  DECIMAL(5,2);
ALTER TABLE "label_format_profiles" ADD COLUMN "marginBottomMm" DECIMAL(5,2);
ALTER TABLE "label_format_profiles" ADD COLUMN "marginLeftMm"   DECIMAL(5,2);
