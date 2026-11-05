-- =============================================================================
-- Hizmet fiyat tablosu (2026-11-06) — `ItemPrice` kademe ekseni + ileri tarihli fiyat
-- =============================================================================
-- M1 `propertyValueId`: hizmetin bağlı olduğu ÇEŞİT değeri ("Kurşun 40 gr") başına fiyat.
--    NULL = kalem geneli (bugünkü HER satır). FK RESTRICT: fiyat satırı olan değer silinemez
--    (değerler zaten silinmez, pasife alınır).
-- K4 `validFrom`: geçerlilik başlangıcı; NULL = `createdAt` (bugünkü her satır). ZAMANLANMIŞ DAMGA
--    modeli: ileri tarihli satır doğarken yürürlükteki satırın `revokedAt`ı o tarihe kurulur →
--    anahtar başına `revokedAt IS NULL` satır yine TEK; tekillikte `validFrom` YOK.
-- M2 iki partial unique ifade indeksine çevrilir: (…, COALESCE(propertyValueId), …).
--    Mevcut satırlar NULL → sıfır-UUID'ye düşer, yani bugünkü aktif küme AYNI anahtarla
--    tekildir; kurulum mükerrere düşemez.
-- M3 as-of index'e `propertyValueId`.
--
-- GÜVENLİ: iki NULLABLE kolon, mevcut satırlara UPDATE YOK. SED KESİNTİSİZ: yeni index geçici
-- adla kurulur, eskisi düşer, ad devralınır (emsal 20261024131826). Şemada `@@unique` YOK
-- (Prisma ifade indeksini görmez); envanter `scripts/test_db_invariants.ts`.
-- =============================================================================

ALTER TABLE "item_prices" ADD COLUMN IF NOT EXISTS "propertyValueId" UUID;
ALTER TABLE "item_prices" ADD COLUMN IF NOT EXISTS "validFrom" TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_prices_propertyValueId_fkey') THEN
    ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_propertyValueId_fkey"
      FOREIGN KEY ("propertyValueId") REFERENCES "fabric_property_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "item_prices_propertyValueId_idx" ON "item_prices"("propertyValueId");

-- Aktif kart varsayılanı: kalem × kademe × yön × para birimi başına TEK.
CREATE UNIQUE INDEX IF NOT EXISTS "item_price_default_uq_new"
  ON "item_prices" ("itemId", COALESCE("propertyValueId", '00000000-0000-0000-0000-000000000000'::uuid), "kind", "currency")
  WHERE "customerId" IS NULL AND "revokedAt" IS NULL;
DROP INDEX IF EXISTS "item_price_default_uq";
ALTER INDEX IF EXISTS "item_price_default_uq_new" RENAME TO "item_price_default_uq";

-- Aktif müşteri istisnası: aynı anahtar + müşteri başına TEK.
CREATE UNIQUE INDEX IF NOT EXISTS "item_price_customer_uq_new"
  ON "item_prices" ("itemId", "customerId", COALESCE("propertyValueId", '00000000-0000-0000-0000-000000000000'::uuid), "kind", "currency")
  WHERE "customerId" IS NOT NULL AND "revokedAt" IS NULL;
DROP INDEX IF EXISTS "item_price_customer_uq";
ALTER INDEX IF EXISTS "item_price_customer_uq_new" RENAME TO "item_price_customer_uq";

-- "Fiyat şu tarih itibarıyla": anahtar (kademe dahil) + pencere başı.
CREATE INDEX IF NOT EXISTS "item_prices_asof_idx_new" ON "item_prices" ("itemId", "propertyValueId", "kind", "currency", "createdAt");
DROP INDEX IF EXISTS "item_prices_asof_idx";
ALTER INDEX IF EXISTS "item_prices_asof_idx_new" RENAME TO "item_prices_asof_idx";
