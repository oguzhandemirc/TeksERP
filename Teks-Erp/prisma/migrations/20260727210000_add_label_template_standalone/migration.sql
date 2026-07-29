-- Serbest (statik) etiket şablonu bayrağı — LabelTemplate.standalone.
-- Salt-eklemeli tek kolon: Postgres 11+ sabit DEFAULT'lu ADD COLUMN tablo
-- yeniden yazmaz (metadata-only), canlı kurulumda güvenli.
ALTER TABLE "label_templates" ADD COLUMN "standalone" BOOLEAN NOT NULL DEFAULT false;
