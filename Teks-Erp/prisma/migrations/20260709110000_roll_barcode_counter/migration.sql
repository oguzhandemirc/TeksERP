-- Top barkod sıra sayacı (gün+tip başına atomik). generateRollBarcode:
--   INSERT ... ON CONFLICT (day,type) DO UPDATE SET n = n+1 RETURNING n
-- → sıra ÇAKIŞMASIZ (satır kilidi), sunucu-üretimi kısa barkod (TEKS+YYMMDD+H/F+A001..).
CREATE TABLE "roll_barcode_counters" (
  "day"  VARCHAR(6) NOT NULL,
  "type" VARCHAR(1) NOT NULL,
  "n"    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "roll_barcode_counters_pkey" PRIMARY KEY ("day", "type")
);
