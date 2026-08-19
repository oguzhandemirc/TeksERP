-- =============================================================================
-- ARAMA KATLAMASI — tr_fold gölge kolonları + Türkçe sıralama (2026-08-19)
-- Tasarım: docs/design/ARAMA-KATLAMA-SIRALAMA-TASARIM.md (F2)
-- =============================================================================
-- Aranan her metin kolonunun yanına DB'nin ürettiği `<kolon>Fold` gölgesi konur.
-- Arama artık terimi 32 varyanta açmak yerine TEK `contains` ile katlanmış
-- kolona bakar. Ölçüm (200 bin satır): 8.461 ms Seq Scan → 2,6 ms Bitmap Index.
--
-- ⚠️ SIRA LOAD-BEARING — collation değişimi generated kolondan ÖNCE gelmeli.
-- Aksi hâlde PostgreSQL reddeder (ölçüldü 2026-08-19):
--   ERROR: cannot alter type of a column used by a generated column
-- Aynı tuzak İLERİDE de geçerli: katlanmış bir kolonun tipini/collation'ını
-- değiştirmek isteyen, önce gölge kolonu DROP etmek zorunda.
--
-- ⚠️ `unaccent` KULLANILMIYOR ve gerekmiyor — gerekçe `src/utils/search-fold.ts`
-- başlığında. `pg_trgm` GEREKLİDİR ama ZORUNLU DEĞİLDİR: yoksa arama yine
-- çalışır (katlanmış kolon + LIKE), yalnız index'siz kalır. Bkz. bölüm 1.
--
-- ⚠️ UNIQUE index BİLİNÇLİ OLARAK YOK — gerekçe aşağıda (bölüm 6).
--
-- ⚠️ BU DOSYA 2026-08-19'da UYGULANDIKTAN SONRA BİR KEZ DEĞİŞTİRİLDİ (uzantı
-- bloğu fail-soft yapıldı). Normalde migration dosyaları IMMUTABLE'dır ve
-- `npm run check:migrations` bunu haklı olarak uyarır. İstisnanın gerekçesi:
--   (a) migration PRODUCTION'A HİÇ UYGULANMADI — kural deploy edilmiş
--       migration'ları korur, checksum yalnız dev'de tutuluyordu;
--   (b) düzeltme SONRAKİ bir migration'a YAZILAMAZDI — burada patlayan bir
--       migration `migrate deploy`'u durdurur, sonraki dosya hiç koşmaz.
-- Dev'in checksum'ı `migrate resolve --applied` ile yeniden üretildi.
-- İKİNCİ DÜZENLEME (aynı gün): `tr_sort` sayı-duyarlı hâle getirildi. Sebep aynı
-- ve buradaki alternatif DAHA KÖTÜYDÜ — collation'ı sonradan değiştirmek, ona
-- bağlı 31 gölge kolonu DÜŞÜRÜP geri koymayı gerektiriyor (PostgreSQL "cannot
-- alter type of a column used by a generated column" ile reddediyor, ölçüldü).
-- Yani production'a ya bu tek temiz dosya gider, ya da gereksiz bir çalkantı
-- migration'ı. Production'a çıktıktan sonra bu dosya gerçekten donar.
-- =============================================================================

-- Büyük tabloya index eklerken app DB'sinin statement_timeout=50s'i migration'ı
-- yarıda keser (perf kuralı 14). Boş kurulumda etkisiz, dolu DB'de hayat kurtarır.
SET statement_timeout = 0;

-- ── 1) Uzantı — ÖNCE KURMAYI DENE, olmuyorsa deploy'u DURDURMA ─────────────
-- pg_trgm PG13+'ta `trusted`: süper kullanıcı GEREKMEZ. Sahadaki kurulumda
-- (PG 16.9 Windows) kurulu DEĞİL — 2026-08-14 yedeğinde doğrulandı; contrib
-- dosyalarının orada olup olmadığı yedekten görülemiyor.
--
-- ⚠️ NEDEN EXCEPTION İLE SARILI (2026-08-19 kararı): çıplak `CREATE EXTENSION`
-- contrib eksikse migration'ı DÜŞÜRÜR ve `migrate deploy` tam burada durur —
-- yani bir PAKETLEME eksiği yüzünden 18 migration'lık bir sürüm yarıda kalır.
-- Oysa uzantı bu tasarımda ZORUNLU DEĞİL: katlama `tr_fold` fonksiyonuna bağlı,
-- arama `nameFold LIKE '%…%'` ile index'siz de DOĞRU çalışır (ölçüldü — gerçek
-- fabrika verisinde "sahin"→ADNAN ŞAHİN ÜRETİM, "akkus"→AKKUŞ TEKSTİL).
-- Kaybolan tek şey HIZDIR ve bugünkü hacimde fark edilmez.
--
-- ⚠️ AMA BU BİR BORÇTUR VE FAİZİ BÜYÜR: veri büyüdükçe index'siz `contains`
-- araması doğrusal yavaşlar (200 bin satırda ölçüldü: 583 ms ↔ 6 ms). Borç
-- SESSİZ kalmasın diye iki bekçi kırmızıya döner ve öyle kalır:
--   • `scripts/test_db_invariants.ts` → "pg_trgm YOK"
--   • `scripts/test_schema_drift.ts`  → 9 belgesiz index farkı
-- Sonradan kurma reçetesi: `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md`.
DO $ext$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  RAISE NOTICE 'pg_trgm hazır — trigram index''leri kurulacak.';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '=======================================================';
  RAISE WARNING 'pg_trgm KURULAMADI: %', SQLERRM;
  RAISE WARNING 'Arama ÇALIŞACAK ama INDEX''SİZ olacak (yavaş, veri büyüdükçe daha yavaş).';
  RAISE WARNING 'BORÇ: contrib dosyalarını kur, sonra deploy notundaki';
  RAISE WARNING '"pg_trgm sonradan kurulumu" bloğunu koştur. Bekçiler kırmızı kalacak.';
  RAISE WARNING '=======================================================';
END
$ext$;

-- ── 2) tr_fold — katlama fonksiyonu ─────────────────────────────────────────
-- JS ikizi `src/utils/search-fold.ts` ile BİREBİR aynı çıktıyı üretir; bekçi
-- `scripts/test_fold_contract.ts` bunu tüm BMP'de (63.485 karakter) ölçer.
-- Adımlar: NFD → birleştirici işaretleri at → istisna tablosu → YALNIZ ASCII
-- küçültme (COLLATE "C") → boşluk tekleme/kırpma.
--
-- ⚠️ `COLLATE "C"` pini SÜS DEĞİL: kolonlar Türkçe sıralama collation'ına
-- geçiyor ve tr collation altında lower('I') = 'ı' olur — katlama i-ailesini
-- ayırır ve arama sessizce bozulurdu. Ayrıca dev (ICU en-US) ile sahadaki
-- C locale kurulumunun AYNI sonucu vermesini bu pin sağlıyor.
--
-- ⚠️ IMMUTABLE beyanı DOĞRUDUR: normalize/regexp_replace/translate/lower'ın
-- hepsi IMMUTABLE ve Unicode normalizasyon kararlılık politikası ayrışımın
-- sürümler arası değişmeyeceğini garanti eder.
CREATE OR REPLACE FUNCTION public.tr_fold(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
  SELECT btrim(
    regexp_replace(
      lower(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(
          translate(
            regexp_replace(normalize($1, NFD), '[̀-ͯ]', '', 'g'),
            'ıØøŁłĐđÐðĦħŦŧŊŋĿŀſ',
            'iOoLlDdDdHhTtNnLls'),
        'Æ', 'AE'), 'æ', 'ae'), 'Œ', 'OE'), 'œ', 'oe'), 'Þ', 'TH'),
        'þ', 'th'), 'ß', 'ss'), 'Ĳ', 'IJ'), 'ĳ', 'ij')
      COLLATE "C"),
    '[ \t\n\r\f\v]+', ' ', 'g'),
  ' ');
$fn$;

-- ── 3) tr_sort — Türkçe SIRALAMA harmanlaması ───────────────────────────────
-- Arama katlar (ç≡c), sıralama AYIRIR (ç≠c, Ç bütün C'lerden sonra). İki ayrı
-- araç; karıştırılırsa "Çanakkale" listede "Cebeci"nin önüne düşer.
-- Sahadaki kurulum C locale: bugün Ç/Ğ/İ/Ö/Ş/Ü ile başlayan HER ad Z'den sonra
-- sıralanıyor (ölçüldü: Cebeci < Ceyhan < Işık < Zonguldak < Çanakkale < İnci).
--
-- ⚠️ `tr-u-kn` = SAYI-DUYARLI sıralama: "9 YEŞİL" < "1000 MAVİ" ve "P2" < "P10".
-- Onsuz sözlüksel sıra uygulanır ve "P10" ile "P2"nin arası ters görünür. Panel de
-- `Intl.Collator('tr', {numeric:true})` kullanıyor — ikisi AYNI kuralı uygulamalı,
-- yoksa sunucudan sıralı gelen liste ile istemcide sıralanan liste ayrışır.
-- Renk adları bugün sıfır dolgulu ("01-BEYAZ") olduğu için fark görünmüyor;
-- dolgusuz tek bir ad girildiği an görünür olur.
--
-- ⚠️ libc yedeğinde sayı-duyarlılık YOKTUR (yalnız ICU destekler). O dala
-- düşülürse Türkçe sıra doğru, sayısal sıra sözlükseldir — kabul edilir bir
-- azalmadır, arama hiç etkilenmez.
--
-- ⚠️ ICU yoksa libc'ye düşülür; ikisi de yoksa sıralama bugünkü hâlinde KALIR
-- (arama etkilenmez). Sessiz değil: NOTICE basılır.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'tr_sort'
             AND collnamespace = 'public'::regnamespace) THEN
    RAISE NOTICE 'tr_sort zaten var, atlanıyor';
    RETURN;
  END IF;
  BEGIN
    CREATE COLLATION public.tr_sort (provider = icu, locale = 'tr-u-kn-true');
    RAISE NOTICE 'tr_sort ICU ile kuruldu (Türkçe + sayı-duyarlı)';
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      CREATE COLLATION public.tr_sort (provider = libc, locale = 'tr_TR.UTF-8');
      RAISE NOTICE 'tr_sort libc ile kuruldu — ICU yok, SAYI-DUYARLILIK YOK';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'tr_sort KURULAMADI (ne ICU ne libc tr_TR) — sıralama değişmedi';
    END;
  END;
END $$;

-- ── 4) Türkçe sıralama: ad kolonları ────────────────────────────────────────
-- ⚠️ Generated kolonlardan ÖNCE (bkz. başlıktaki sıra uyarısı).
-- KOD kolonlarına DOKUNULMAZ: kod üretimi `startsWith` prefix taraması yapıyor
-- ve o, C/varsayılan collation'ın byte sırasına dayanıyor.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'tr_sort'
                 AND collnamespace = 'public'::regnamespace) THEN
    RAISE NOTICE 'tr_sort yok — collation adımı atlandı';
    RETURN;
  END IF;
  ALTER TABLE "customers" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "items" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "colors" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "stations" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "machines" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "subcontractors" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "subcontractor_categories" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "routes" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "product_recipes" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "quality_grades" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "defect_types" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "return_reasons" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "fabric_properties" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "peripheral_devices" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "customer_branches" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "permission_templates" ALTER COLUMN "name" TYPE character varying(64) COLLATE public.tr_sort;
  ALTER TABLE "label_templates" ALTER COLUMN "name" TYPE character varying(100) COLLATE public.tr_sort;
  ALTER TABLE "users" ALTER COLUMN "fullName" TYPE character varying(100) COLLATE public.tr_sort;
END $$;

-- ── 5) Katlanmış gölge kolonlar (DB üretir, uygulama HİÇ YAZMAZ) ────────────
-- ⚠️ Kapsam = SUNUCUDA ARANAN kolonlar. `users."fullName"` bilerek YOK: sıralanıyor
-- (collation aldı) ama sunucu araması yok — kullanıcı listesi istemcide süzülüyor.
-- Aranmayan kolona gölge eklemek, bakılması gereken yüzeyi bedavaya büyütür.
ALTER TABLE "customers" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "items" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "colors" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "stations" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "machines" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "subcontractors" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "subcontractor_categories" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "routes" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "product_recipes" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "quality_grades" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "quality_grades" ADD COLUMN "descriptionFold" text GENERATED ALWAYS AS (public.tr_fold("description")) STORED;
ALTER TABLE "defect_types" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "defect_types" ADD COLUMN "descriptionFold" text GENERATED ALWAYS AS (public.tr_fold("description")) STORED;
ALTER TABLE "return_reasons" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "return_reasons" ADD COLUMN "descriptionFold" text GENERATED ALWAYS AS (public.tr_fold("description")) STORED;
ALTER TABLE "fabric_properties" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "fabric_properties" ADD COLUMN "descriptionFold" text GENERATED ALWAYS AS (public.tr_fold("description")) STORED;
ALTER TABLE "fabric_properties" ADD COLUMN "categoryFold" text GENERATED ALWAYS AS (public.tr_fold("category")) STORED;
ALTER TABLE "peripheral_devices" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "peripheral_devices" ADD COLUMN "addressFold" text GENERATED ALWAYS AS (public.tr_fold("address")) STORED;
ALTER TABLE "customer_branches" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "customer_branches" ADD COLUMN "cityFold" text GENERATED ALWAYS AS (public.tr_fold("city")) STORED;
ALTER TABLE "permission_templates" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "label_templates" ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "order_lines" ADD COLUMN "customerItemNameFold" text GENERATED ALWAYS AS (public.tr_fold("customerItemName")) STORED;
ALTER TABLE "direct_shipments" ADD COLUMN "reasonFold" text GENERATED ALWAYS AS (public.tr_fold("reason")) STORED;
ALTER TABLE "shipments" ADD COLUMN "plateNumberFold" text GENERATED ALWAYS AS (public.tr_fold("plateNumber")) STORED;
ALTER TABLE "shipments" ADD COLUMN "driverNameFold" text GENERATED ALWAYS AS (public.tr_fold("driverName")) STORED;
ALTER TABLE "shipments" ADD COLUMN "carrierFold" text GENERATED ALWAYS AS (public.tr_fold("carrier")) STORED;
ALTER TABLE "roll_returns" ADD COLUMN "reasonTextFold" text GENERATED ALWAYS AS (public.tr_fold("reasonText")) STORED;
ALTER TABLE "roll_returns" ADD COLUMN "noteFold" text GENERATED ALWAYS AS (public.tr_fold("note")) STORED;

-- ── 6) Index'ler ────────────────────────────────────────────────────────────
-- btree: mükerrer kontrolünün O(N) tam tablo taramasını O(1)'e indirir.
--
-- ⚠️ UNIQUE DEĞİL — ve bu bilinçli bir GERİ ADIM. Tasarım UNIQUE öngörüyordu
-- (kullanıcı onaylı D3) ama canlı veride BUGÜN gerçek mükerrerler var; ölçüldü:
--   customers: 'Moda Tekstil' + 'MODA TEKSTİL' — İKİSİ DE AKTİF
--   items: 'ACTIVO' + 'ACTİVO' · 'KRİSTAL' ×2 · 'OSLO' ×2 · 'V-1430' ×2
--   subcontractors ×3, colors ×1 (pasif+aktif çiftleri)
-- UNIQUE eklemek bu satırlarda migration'ı DEPLOY ANINDA düşürürdü ve çözümü
-- gerçek kayıtları birleştirmek olurdu — bu bir İŞ kararıdır, migration'ın
-- işi değil. Kullanıcıya vaat edilen davranış (aynı ad ikinci kez eklenemez)
-- uygulama katmanında zaten sağlanıyor ve artık bu index sayesinde ucuz.
-- Repo'nun bu konudaki duran kararı da aynı yönde (app-level guard, DB kısıtı
-- yok — tarihsel mükerrer migration'ı patlatır).
-- Rapor: `npx tsx scripts/find_fold_duplicates.ts` (salt-okunur).
-- Cumartesi sıfırlamasından SONRA tablolar boşken UNIQUE eklemek 5 satırlık
-- ve risksiz bir migration olur — o zaman değerlendirilir.
CREATE INDEX "customers_nameFold_idx" ON "customers" ("nameFold");
CREATE INDEX "items_nameFold_idx" ON "items" ("nameFold");
CREATE INDEX "colors_nameFold_idx" ON "colors" ("nameFold");
CREATE INDEX "stations_nameFold_idx" ON "stations" ("nameFold");
CREATE INDEX "machines_nameFold_idx" ON "machines" ("nameFold");
CREATE INDEX "subcontractors_nameFold_idx" ON "subcontractors" ("nameFold");
CREATE INDEX "subcontractor_categories_nameFold_idx" ON "subcontractor_categories" ("nameFold");
CREATE INDEX "routes_nameFold_idx" ON "routes" ("nameFold");
CREATE INDEX "product_recipes_nameFold_idx" ON "product_recipes" ("nameFold");
CREATE INDEX "quality_grades_nameFold_idx" ON "quality_grades" ("nameFold");
CREATE INDEX "quality_grades_descriptionFold_idx" ON "quality_grades" ("descriptionFold");
CREATE INDEX "defect_types_nameFold_idx" ON "defect_types" ("nameFold");
CREATE INDEX "defect_types_descriptionFold_idx" ON "defect_types" ("descriptionFold");
CREATE INDEX "return_reasons_nameFold_idx" ON "return_reasons" ("nameFold");
CREATE INDEX "return_reasons_descriptionFold_idx" ON "return_reasons" ("descriptionFold");
CREATE INDEX "fabric_properties_nameFold_idx" ON "fabric_properties" ("nameFold");
CREATE INDEX "fabric_properties_descriptionFold_idx" ON "fabric_properties" ("descriptionFold");
CREATE INDEX "fabric_properties_categoryFold_idx" ON "fabric_properties" ("categoryFold");
CREATE INDEX "peripheral_devices_nameFold_idx" ON "peripheral_devices" ("nameFold");
CREATE INDEX "peripheral_devices_addressFold_idx" ON "peripheral_devices" ("addressFold");
CREATE INDEX "customer_branches_nameFold_idx" ON "customer_branches" ("nameFold");
CREATE INDEX "customer_branches_cityFold_idx" ON "customer_branches" ("cityFold");
CREATE INDEX "permission_templates_nameFold_idx" ON "permission_templates" ("nameFold");
CREATE INDEX "label_templates_nameFold_idx" ON "label_templates" ("nameFold");
CREATE INDEX "order_lines_customerItemNameFold_idx" ON "order_lines" ("customerItemNameFold");
CREATE INDEX "direct_shipments_reasonFold_idx" ON "direct_shipments" ("reasonFold");
CREATE INDEX "shipments_plateNumberFold_idx" ON "shipments" ("plateNumberFold");
CREATE INDEX "shipments_driverNameFold_idx" ON "shipments" ("driverNameFold");
CREATE INDEX "shipments_carrierFold_idx" ON "shipments" ("carrierFold");
CREATE INDEX "roll_returns_reasonTextFold_idx" ON "roll_returns" ("reasonTextFold");
CREATE INDEX "roll_returns_noteFold_idx" ON "roll_returns" ("noteFold");

-- GIN trigram: YALNIZ büyüyen tablolarda. `contains` (%terim%) aramasını
-- index'e bağlayan tek yol budur; küçük ana veri tablolarında (onlarca satır)
-- planlayıcı zaten seq scan seçer, GIN sırf bakım maliyeti olurdu.
DO $gin$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE WARNING 'pg_trgm yok — 9 trigram index ATLANDI. Arama index''siz çalışacak.';
    RETURN;
  END IF;
  EXECUTE $sql$
    CREATE INDEX "customers_nameFold_trgm_idx" ON "customers" USING gin ("nameFold" gin_trgm_ops);
    CREATE INDEX "items_nameFold_trgm_idx" ON "items" USING gin ("nameFold" gin_trgm_ops);
    CREATE INDEX "colors_nameFold_trgm_idx" ON "colors" USING gin ("nameFold" gin_trgm_ops);
    CREATE INDEX "order_lines_customerItemNameFold_trgm_idx" ON "order_lines" USING gin ("customerItemNameFold" gin_trgm_ops);
    CREATE INDEX "orders_orderNumber_trgm_idx" ON "orders" USING gin ("orderNumber" gin_trgm_ops);
    CREATE INDEX "work_orders_workOrderNumber_trgm_idx" ON "work_orders" USING gin ("workOrderNumber" gin_trgm_ops);
    CREATE INDEX "shipments_shipmentNo_trgm_idx" ON "shipments" USING gin ("shipmentNo" gin_trgm_ops);
    CREATE INDEX "batches_batchNumber_trgm_idx" ON "batches" USING gin ("batchNumber" gin_trgm_ops);
    CREATE INDEX "sacks_sackNo_trgm_idx" ON "sacks" USING gin ("sackNo" gin_trgm_ops);
  $sql$;
  RAISE NOTICE '9 trigram index kuruldu.';
END
$gin$;
