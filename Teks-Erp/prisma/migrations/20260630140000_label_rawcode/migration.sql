-- Uzman raw-code override: etiket düzeni başına dil-bazlı (PPLA/PPLB/ZPL/RASTER_HTML)
-- ham kod. Doluysa otomatik üretim yerine basılır. Manuel migration (psql + resolve).
ALTER TABLE "label_templates" ADD COLUMN "rawCode" JSONB;
