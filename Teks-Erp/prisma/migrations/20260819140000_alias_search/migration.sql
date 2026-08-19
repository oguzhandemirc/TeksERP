-- =============================================================================
-- MÜŞTERİ ALIAS'LARI ARANABİLİR OLSUN (2026-08-19)
-- =============================================================================
-- Müşterinin bizim ürüne verdiği ad (`customer_item_aliases.alias`) etikete ve
-- irsaliyeye BASILIYOR ama hiçbir arama kutusundan BULUNMUYORDU. Canlı veride
-- 19 alias var ve örnekler sorunun ne olduğunu tek başına anlatıyor:
--     MODA TEKSTİL → bizim "KREP"     = müşteride "TRİPLİ VUAL"
--     BOYER        → bizim "18152"    = müşteride "BELLE"
-- Müşteri telefonda "BELLE'den 200 metre" dediğinde, o adı sisteme yazan kişi
-- hiçbir sonuç alamıyor; eşleştirmeyi kafadan bilmek zorunda kalıyordu.
--
-- Çözüm ada dokunmuyor: `search_fold` migration'ındaki desenin aynısı —
-- `aliasFold` gölge kolonu + index. Arama yolları `item.customerAliases.some.
-- aliasFold` ile besleniyor (bkz. `src/utils/query-parser.ts`).
--
-- ⚠️ Alias KAPSAM TAŞIR ama arama kapsamı DARALTMAZ: "BELLE" arayan kişi, o ad
-- yalnız BOYER'in defterinde olsa bile ürünü bulur. Bilinçli — bu bir arama
-- yardımıdır, yetki/görünürlük kısıtı değil; sonuç listesi her zaman BİZİM
-- adımızı gösterir (ürün adı görüntüleme konvansiyonu).
-- =============================================================================

SET statement_timeout = 0;

ALTER TABLE "customer_item_aliases"  ADD COLUMN "aliasFold" text GENERATED ALWAYS AS (public.tr_fold("alias")) STORED;
ALTER TABLE "customer_color_aliases" ADD COLUMN "aliasFold" text GENERATED ALWAYS AS (public.tr_fold("alias")) STORED;

CREATE INDEX "customer_item_aliases_aliasFold_idx"  ON "customer_item_aliases"  ("aliasFold");
CREATE INDEX "customer_color_aliases_aliasFold_idx" ON "customer_color_aliases" ("aliasFold");

-- Trigram: alias tablosu müşteri × ürün çarpımıyla büyür (bugün 19, kurulum
-- başına binlere çıkabilir) ve `contains` ile aranıyor. Uzantı yoksa ATLANIR —
-- `search_fold` migration'ındaki fail-soft davranışın aynısı.
DO $gin$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE WARNING 'pg_trgm yok — alias trigram index''leri ATLANDI (arama index''siz çalışır).';
    RETURN;
  END IF;
  EXECUTE $sql$
    CREATE INDEX "customer_item_aliases_aliasFold_trgm_idx"  ON "customer_item_aliases"  USING gin ("aliasFold" gin_trgm_ops);
    CREATE INDEX "customer_color_aliases_aliasFold_trgm_idx" ON "customer_color_aliases" USING gin ("aliasFold" gin_trgm_ops);
  $sql$;
  RAISE NOTICE 'alias trigram index''leri kuruldu.';
END
$gin$;
