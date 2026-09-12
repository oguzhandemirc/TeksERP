-- =============================================================================
-- OrderLine.unit — satır birimi (ItemUnit: MT | KG | ADET). ADDITIVE.
-- Kolon MT varsayılanıyla eklenir, kalem kartından (items.unit) backfill edilir.
-- MT dışı + shippedQty > 0 satır (ikinci kurulum senaryosu) SAYILIR, rakamı
-- DEĞİŞTİRİLMEZ — migration ölçer ve söyler, karar vermez.
-- İdempotent: ikinci koşumda kolon vardır, UPDATE 0 satır günceller.
-- =============================================================================

ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "unit" "ItemUnit" NOT NULL DEFAULT 'MT';

UPDATE "order_lines" ol
SET "unit" = i."unit"
FROM "items" i
WHERE i."id" = ol."itemId"
  AND ol."unit" <> i."unit";

DO $$
DECLARE
  n_non_mt integer;
  n_inflated integer;
BEGIN
  SELECT count(*) INTO n_non_mt FROM "order_lines" WHERE "unit" <> 'MT';
  SELECT count(*) INTO n_inflated FROM "order_lines" WHERE "unit" <> 'MT' AND "shippedQty" > 0;
  RAISE NOTICE 'order_lines.unit backfill: MT-disi satir = %, MT-disi ve shippedQty>0 (metreyle sismis, DOKUNULMADI) = %', n_non_mt, n_inflated;
END $$;
