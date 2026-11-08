-- Fason F7b (2026-11-08): iş emrinde "ana hammaddeyi kim verdi" — BU FABRİKANIN bakışı
-- (CUSTOMER = işin müşterisi · US = bu fabrika · MIXED = karışık). Yalnız bilgi + tevkifat önerisine girdi.
-- ADDITIVE: yeni enum tipi (bu dosyada DOĞUYOR → CREATE TYPE + kullanım aynı dosyada serbest) + nullable kolon.
-- Veri değişikliği YOK: NULL = bilinmiyor = bugünkü davranış; mevcut iş emirleri tahminle doldurulmaz.

DO $t$ BEGIN CREATE TYPE "MaterialProvider" AS ENUM ('CUSTOMER', 'US', 'MIXED'); EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "materialProvidedBy" "MaterialProvider";
