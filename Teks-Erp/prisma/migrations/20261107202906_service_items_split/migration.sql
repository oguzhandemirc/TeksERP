-- =============================================================================
-- HİZMET KARTI AYRIMI (D0) — `items`taki SERVICE kalemleri `service_items`a TAŞINIR.
-- Plan: PLAN-urun-hizmet-karti.md §4 · kararlar K1–K4 (2026-11-08) · GERİ ALINAMAZ.
-- Taşıma, defter silmesi DEĞİLDİR: her hizmet AYNI UUID + aynı kod/ad/künye ile
-- `service_items`ta yaşar, bağlı satırlar (fiyat, fatura kalemi, 5 hizmet tablosu)
-- yalnız FK hedefi değiştirir; raporlanan hiçbir sayı değişmez (defter testi).
-- Doğrulama: scripts/hizmet-karti-tasima-kontrol.ts (önce/sonra) · bekçi
-- scripts/test_hizmet_karti_tasima.ts. Boş-veri yolu (SERVICE'siz kurulum) 0 satırla geçer.
-- Bilinçli DROP CONSTRAINT: yalnız beş `…_serviceItemId_fkey` (hedef değişir); iki
-- DEFERRABLE FK (`rolls`/`swatches` sackId_shipmentId) satırları kök kuralla SİLİNDİ.
-- =============================================================================

-- ── 0) FAIL-CLOSED KAPI — DDL'den ÖNCE, hiçbir şey değişmeden durur ────────────
-- (a) Hizmet id'sine stok/üretim/ticaret tablosundan bakan kayıt (bugünkü tür
--     kapısı açıklarından sızmış olabilir): katalogdan `items`a bakan HER FK taranır;
--     taşınan bağlar (5 hizmet tablosu, fiyat, fatura kalemi, birleşme soyu) hariç.
DO $$
DECLARE
  r      record;
  n      bigint;
  toplam bigint := 0;
  ozet   text   := '';
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tablo, a.attname::text AS kolon
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.items'::regclass
      AND (c.conrelid::regclass::text, a.attname::text) NOT IN (
        ('fabric_properties', 'serviceItemId'),
        ('fabric_property_values', 'serviceItemId'),
        ('service_billing_links', 'serviceItemId'),
        ('service_consumable_norms', 'serviceItemId'),
        ('expense_allocations', 'serviceItemId'),
        ('item_prices', 'itemId'),
        ('invoice_lines', 'itemId'),
        ('items', 'mergedIntoId'),
        -- Saf yapılandırma pivotları (defter ③b; FK'ları zaten ON DELETE CASCADE): kapıyı durdurmaz, 0d'de silinir.
        ('item_allowed_colors', 'itemId'),
        ('item_allowed_properties', 'itemId'),
        ('customer_item_aliases', 'itemId'),
        ('customer_item_color_aliases', 'itemId'))
    ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s t WHERE t.%I IN (SELECT i."id" FROM "items" i WHERE i."itemType" = ''SERVICE'')',
      r.tablo, r.kolon) INTO n;
    IF n > 0 THEN
      toplam := toplam + n;
      ozet := ozet || format(' %s.%s=%s', r.tablo, r.kolon, n);
    END IF;
  END LOOP;
  IF toplam > 0 THEN
    RAISE EXCEPTION 'Hizmet kartı taşıması DURDU: % kayıt hizmet kalemine stok/üretim tablosundan bağlı (%). Önce "npx tsx scripts/hizmet-karti-tasima-kontrol.ts" ile listeleyin ve kullanıcı onayıyla düzeltin.', toplam, btrim(ozet);
  END IF;
END $$;

-- (b) Birleşme soyu tür sınırını geçmemeli (tür birleştirme kimliğidir; geçen soy taşınamaz).
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM "items" c JOIN "items" s ON s."id" = c."mergedIntoId"
  WHERE (c."itemType" = 'SERVICE') <> (s."itemType" = 'SERVICE');
  IF n > 0 THEN
    RAISE EXCEPTION 'Hizmet kartı taşıması DURDU: % kart hizmet ile ürün arasında birleşmiş (mergedIntoId tür sınırını geçiyor).', n;
  END IF;
END $$;

-- (c) Kademe (propertyValueId) yalnız hizmet fiyatında yaşar; ürün fiyatında kademe varsa CHECK kurulamaz.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM "item_prices" p JOIN "items" i ON i."id" = p."itemId"
  WHERE p."propertyValueId" IS NOT NULL AND i."itemType" <> 'SERVICE';
  IF n > 0 THEN
    RAISE EXCEPTION 'Hizmet kartı taşıması DURDU: % ürün fiyatı satırında kademe (propertyValueId) dolu; kademe yalnız hizmet fiyatında olabilir.', n;
  END IF;
END $$;

-- (d) Hizmet kartına bağlı SAF YAPILANDIRMA PİVOTU satırları silinir (defter ③b izinli hard delete):
--     izinli renk/özellik listesi ve müşteri ürün/renk adı hizmette anlamsızdır (alias kapısı 2026-11-06'dan beri
--     reddeder). Hiçbir sayı değişmez; deploy öncesi liste `scripts/hizmet-karti-tasima-kontrol.ts`te.
DELETE FROM "item_allowed_colors" WHERE "itemId" IN (SELECT i."id" FROM "items" i WHERE i."itemType" = 'SERVICE');
DELETE FROM "item_allowed_properties" WHERE "itemId" IN (SELECT i."id" FROM "items" i WHERE i."itemType" = 'SERVICE');
DELETE FROM "customer_item_color_aliases" WHERE "itemId" IN (SELECT i."id" FROM "items" i WHERE i."itemType" = 'SERVICE');
DELETE FROM "customer_item_aliases" WHERE "itemId" IN (SELECT i."id" FROM "items" i WHERE i."itemType" = 'SERVICE');

-- ── 1) service_items tablosu ──────────────────────────────────────────────────
CREATE TYPE "InvoiceLineType" AS ENUM ('PRODUCT', 'SERVICE', 'TEXT');

CREATE TABLE "service_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) COLLATE public.tr_sort NOT NULL,
    "unit" "ItemUnit" NOT NULL DEFAULT 'MT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lifecycleStatus" "ItemLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "lifecycleChangedAt" TIMESTAMPTZ,
    "lifecycleChangedById" UUID,
    "lifecycleReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "nameFold" TEXT GENERATED ALWAYS AS (public.tr_fold("name")) STORED,
    "createdById" UUID,
    "updatedById" UUID,
    "mergedIntoId" UUID,
    "mergedAt" TIMESTAMPTZ,
    "mergedById" UUID,

    CONSTRAINT "service_items_pkey" PRIMARY KEY ("id"),
    -- Item emsali (items_lifecycle_isactive_ck): isActive yaşam döngüsünden türer.
    CONSTRAINT "service_items_lifecycle_isactive_ck" CHECK (("lifecycleStatus" = 'ARCHIVED') = (NOT "isActive"))
);

CREATE UNIQUE INDEX "service_items_code_key" ON "service_items"("code");
-- Kod harf-duyarsız tekil (items_code_fold_key emsali; okuyucu küçük harfi büyütür).
CREATE UNIQUE INDEX "service_items_code_fold_key" ON "service_items"(upper("code")) WHERE "mergedIntoId" IS NULL;
CREATE INDEX "service_items_nameFold_idx" ON "service_items"("nameFold");
CREATE INDEX "service_items_nameFold_trgm_idx" ON "service_items" USING GIN ("nameFold" gin_trgm_ops);
CREATE INDEX "service_items_mergedIntoId_idx" ON "service_items"("mergedIntoId") WHERE "mergedIntoId" IS NOT NULL;
CREATE INDEX "service_items_updatedAt_esitleme_idx" ON "service_items"("updatedAt", "id");
-- Canlı ad tekilliği; mezar taşı hariç (items_nameFold_key emsali).
CREATE UNIQUE INDEX "service_items_nameFold_key" ON "service_items"("nameFold") WHERE "mergedIntoId" IS NULL;

ALTER TABLE "service_items" ADD CONSTRAINT "service_items_lifecycleChangedById_fkey" FOREIGN KEY ("lifecycleChangedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 2) Kopya — AYNI id, kod (K2: eski STK- korunur), künye; mezar taşı dahil ──
INSERT INTO "service_items" (
  "id", "code", "name", "unit", "isActive", "lifecycleStatus", "lifecycleChangedAt",
  "lifecycleChangedById", "lifecycleReason", "createdAt", "updatedAt", "createdById",
  "updatedById", "mergedIntoId", "mergedAt", "mergedById")
SELECT "id", "code", "name", "unit", "isActive", "lifecycleStatus", "lifecycleChangedAt",
  "lifecycleChangedById", "lifecycleReason", "createdAt", "updatedAt", "createdById",
  "updatedById", "mergedIntoId", "mergedAt", "mergedById"
FROM "items"
WHERE "itemType" = 'SERVICE';

-- Soy FK'sı kopyadan SONRA (satırlar arası sıra bağımsız olsun).
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "service_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3) Beş hizmet tablosu: kolon ve değer aynı, yalnız FK hedefi (aynı ON DELETE) ──
ALTER TABLE "fabric_properties" DROP CONSTRAINT "fabric_properties_serviceItemId_fkey";
ALTER TABLE "fabric_properties" ADD CONSTRAINT "fabric_properties_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fabric_property_values" DROP CONSTRAINT "fabric_property_values_serviceItemId_fkey";
ALTER TABLE "fabric_property_values" ADD CONSTRAINT "fabric_property_values_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_billing_links" DROP CONSTRAINT "service_billing_links_serviceItemId_fkey";
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_consumable_norms" DROP CONSTRAINT "service_consumable_norms_serviceItemId_fkey";
ALTER TABLE "service_consumable_norms" ADD CONSTRAINT "service_consumable_norms_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_allocations" DROP CONSTRAINT "expense_allocations_serviceItemId_fkey";
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 4) item_prices — ⚠️ SIRA KRİTİK: 6'dan ÖNCE (itemId FK'sı CASCADE; sonra olsa fiyatlar SİLİNİR) ──
ALTER TABLE "item_prices" ADD COLUMN "serviceItemId" UUID, ALTER COLUMN "itemId" DROP NOT NULL;
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "item_prices" p
SET "serviceItemId" = p."itemId", "itemId" = NULL, "updatedAt" = now()
WHERE p."itemId" IN (SELECT s."id" FROM "service_items" s);

-- Fiyatın konusu TAM BİRİ; kademe yalnız hizmette.
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_subject_ck" CHECK (num_nonnulls("itemId", "serviceItemId") = 1);
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_tier_service_ck" CHECK ("propertyValueId" IS NULL OR "serviceItemId" IS NOT NULL);

-- Tekillik konu-bağımsız: UUID'ler iki tabloda çakışmaz (taşınanlar items'tan silinir, yeniler gen_random).
DROP INDEX "item_price_default_uq";
DROP INDEX "item_price_customer_uq";
CREATE UNIQUE INDEX "item_price_default_uq" ON "item_prices" (COALESCE("itemId", "serviceItemId"), COALESCE("propertyValueId", '00000000-0000-0000-0000-000000000000'::uuid), "kind", "currency") WHERE "customerId" IS NULL AND "revokedAt" IS NULL;
CREATE UNIQUE INDEX "item_price_customer_uq" ON "item_prices" (COALESCE("itemId", "serviceItemId"), "customerId", COALESCE("propertyValueId", '00000000-0000-0000-0000-000000000000'::uuid), "kind", "currency") WHERE "customerId" IS NOT NULL AND "revokedAt" IS NULL;
CREATE INDEX "item_prices_service_asof_idx" ON "item_prices"("serviceItemId", "propertyValueId", "kind", "currency", "createdAt");

-- ── 5) invoice_lines — satır tipi + hizmet FK'sı; kesilmiş faturada tutar/kimlik DEĞİŞMEZ ──
ALTER TABLE "invoice_lines" ADD COLUMN "lineType" "InvoiceLineType", ADD COLUMN "serviceItemId" UUID;

UPDATE "invoice_lines" l
SET "serviceItemId" = l."itemId", "itemId" = NULL, "lineType" = 'SERVICE'
WHERE l."itemId" IN (SELECT s."id" FROM "service_items" s);
UPDATE "invoice_lines" SET "lineType" = 'PRODUCT' WHERE "lineType" IS NULL AND "itemId" IS NOT NULL;
UPDATE "invoice_lines" SET "lineType" = 'TEXT' WHERE "lineType" IS NULL;

ALTER TABLE "invoice_lines" ALTER COLUMN "lineType" SET NOT NULL;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "invoice_lines_serviceItemId_idx" ON "invoice_lines"("serviceItemId");
-- Üç durumlu tutarlılık: PRODUCT⇔itemId · SERVICE⇔serviceItemId · TEXT⇔ikisi boş.
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_line_type_ck" CHECK (
  ("lineType" = 'PRODUCT' AND "itemId" IS NOT NULL AND "serviceItemId" IS NULL)
  OR ("lineType" = 'SERVICE' AND "itemId" IS NULL AND "serviceItemId" IS NOT NULL)
  OR ("lineType" = 'TEXT' AND "itemId" IS NULL AND "serviceItemId" IS NULL));

-- ── 6) items'tan kaldır — TAŞIMA (satır aynı id ile service_items'ta yaşıyor) ──
-- items içi soy (mergedIntoId) yalnız hizmet↔hizmet kalabilir (kapı 0b); SET NULL olsa da silinen satırlardadır.
-- Bulut: satır `service_items`ta aynı id ile yaşar ⇒ silme tetikleyicisi buluta SILINDI yazmamalı (patron `urun`
-- projeksiyonu kaydı görmeye devam eder). Tetikleyici yalnız bu ifade için kapanır; migration tek tx'tir.
ALTER TABLE "items" DISABLE TRIGGER "items_sync_deleted";
DELETE FROM "items" WHERE "itemType" = 'SERVICE';
ALTER TABLE "items" ENABLE TRIGGER "items_sync_deleted";

-- ── 7) items artık hizmet taşımaz; enum değeri eski istemci süzgeci için KALIR (plan §5) ──
ALTER TABLE "items" ADD CONSTRAINT "items_no_service_ck" CHECK ("itemType" <> 'SERVICE');

-- ── 8) Bulut silme işareti — `service_items` `urun` projeksiyonunun ek köküdür (aynı UUID uzayı) ──
CREATE TRIGGER "service_items_sync_deleted" AFTER DELETE ON "service_items" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
