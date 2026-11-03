-- =============================================================================
-- Gülkesim S5 — final etiket (tambur): şablon birim sistemi + müşteri tambur/etiket
-- ayarları + iş emri etiket bilgisi.
-- ADDITIVE: yalnız nullable / varsayılanlı kolon (PG11+ metadata-only, tablo yeniden
-- yazılmaz). NULL / false = bugünkü davranış. İdempotent (IF NOT EXISTS).
-- =============================================================================

-- Şablon birim sistemi { system, decimals?, decimalSep? } — NULL = bugünkü metrik biçim.
ALTER TABLE "label_templates" ADD COLUMN IF NOT EXISTS "unitSettings" JSONB;

-- Müşteri: etiketteki en kaynağı · tamburda tartım · bölme ölçüsü önerisi.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "labelWidthSource" VARCHAR(16);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tamburWeighRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tamburSplitLengthM" DECIMAL(10,2);

-- İş emri etiket bilgisi { alan: metin } — NULL = kaynak değerler.
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "labelOverrides" JSONB;
