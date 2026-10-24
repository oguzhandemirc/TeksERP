-- =============================================================================
-- `ItemPrice` damgalı sürümleme (MAL-0b, defter.md ③a — 2026-10-24)
-- =============================================================================
-- Fiyat satırı artık SİLİNMEZ ve fiyatı yerinde EZİLMEZ: değişim eski satırın
-- `revokedAt` damgası + YENİ satır, kaldırma yalnız damgadır. Geçmiş fiyat
-- "şu tarih itibarıyla" okunabilir (`[createdAt, revokedAt)` penceresi).
--
-- ⚠️ İki şema-dışı partial unique (migration 20260814072115) damgalı satırı da
-- sayardı → aynı anahtara İKİNCİ sürüm yazılamazdı. Predicate'lere
-- `"revokedAt" IS NULL` eklenir. Şemada `@@unique` olarak durmaya devam ederler
-- (Prisma 7 predicate farkını drift saymaz); envanter `test_db_invariants.ts`.
--
-- SED KESİNTİSİZ: yeni index geçici adla kurulur, eskisi düşer, ad devralınır
-- (defter.md Tuzaklar; emsal 20260911190000). IF [NOT] EXISTS'ler yarıda kalan
-- koşum yeniden koşulabilsin diye.
--
-- GÜVENLİ: üç NULLABLE kolon, mevcut satırlara UPDATE YOK. Hepsi
-- `revokedAt IS NULL` doğar → yeni predicate bugünkü kümeyi AYNEN korur, index
-- kurulumu mükerrere düşemez. Geçiş öncesi yerinde ezilmiş fiyatın eski değeri
-- zaten kayıptı; mevcut satır `createdAt`ten itibaren bugünkü değeriyle geçerli
-- sayılır (karar notu: arşiv 2026-10 "ItemPrice damgalı sürümleme").
-- =============================================================================

ALTER TABLE "item_prices" ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ;
ALTER TABLE "item_prices" ADD COLUMN IF NOT EXISTS "revokedById"  UUID;
ALTER TABLE "item_prices" ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);

-- Aktif kart varsayılanı TEK (damgalı geçmiş anahtarı bırakır).
CREATE UNIQUE INDEX IF NOT EXISTS "item_price_default_uq_new"
  ON "item_prices" ("itemId", "kind", "currency")
  WHERE "customerId" IS NULL AND "revokedAt" IS NULL;
DROP INDEX IF EXISTS "item_price_default_uq";
ALTER INDEX IF EXISTS "item_price_default_uq_new" RENAME TO "item_price_default_uq";

-- Aktif müşteri istisnası TEK.
CREATE UNIQUE INDEX IF NOT EXISTS "item_price_customer_uq_new"
  ON "item_prices" ("itemId", "customerId", "kind", "currency")
  WHERE "customerId" IS NOT NULL AND "revokedAt" IS NULL;
DROP INDEX IF EXISTS "item_price_customer_uq";
ALTER INDEX IF EXISTS "item_price_customer_uq_new" RENAME TO "item_price_customer_uq";

-- "Fiyat şu tarih itibarıyla" (`itemPriceValidAt`): anahtar + pencere başı.
CREATE INDEX IF NOT EXISTS "item_prices_asof_idx"
  ON "item_prices" ("itemId", "kind", "currency", "createdAt");
