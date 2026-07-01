-- Etiket bayat bayrağı: veri/metraj/renk/kalite/en/özellik "Yeniden Etiketle/Düzelt" ile
-- değişince true → fiziksel etiket veriyle uyuşmuyor (yeniden basılmalı). Baskıda false'a döner.
ALTER TABLE "rolls" ADD COLUMN "labelDirty" BOOLEAN NOT NULL DEFAULT false;
