-- =============================================================================
-- AD MÜKERRERİ DB SEDDİ — `nameFold` partial UNIQUE (3 tablo) · 2026-08-21
-- =============================================================================
-- NEDEN: Kullanıcı kararı D3 ("SAHIN" ≡ "ŞAHİN" → aynı kayıt) 2026-08-19'da
-- uygulama katmanında geldi (`assertNameNotDuplicate` + `nameFold` gölge
-- kolonu) ama DB kısıtı BİLİNÇLİ OLARAK KONMADI: canlıda o gün gerçek
-- mükerrerler vardı (customers 1 · items 4 · subcontractors 3 grup) ve UNIQUE
-- deploy anında düşerdi (`20260819060000_search_fold` §6). Fabrika DB'si
-- 2026-08-22'de SIFIRLANIYOR — tablolar boşken kısıt risksiz; bu pencere bir
-- daha gelmez (sonrası backfill = iş kararı gerektiren birleştirme).
--
-- NEYİ KAPATIR (uygulama bekçisi check-then-act'tir):
--   1) YARIŞ — iki istemci aynı anda aynı adı yazar, ikisinin SELECT'i boş döner,
--      ikisi de INSERT eder (tx/kilit yok).
--   2) YAPILANDIRMA UNUTMASI — `duplicateNameField` verilmeyen yeni bir servis
--      guard'ı sessizce atlar (`if (!field) return`).
--   3) İÇE AKTARIM — adaptör `nameGuard` beyan etmezse kontrol hiç koşmaz
--      (import-name-guard.ts fail-open).
--   4) SERVİSİ ATLAYAN YOLLAR — script, elle SQL, geri yükleme.
-- Bekçi KALDIRILMAZ: kullanıcıya Türkçe, kod bilgili 409'u o verir; bu kısıt
-- sessiz son hattır (P2002 → error.middleware `nameFold`→"ad" eşlemesi).
--
-- KAPSAM: customers · items · subcontractors. PREDICATE `"mergedIntoId" IS NULL`:
-- birleştirme tombstone'u aynı katlanmış adı taşımaya devam eder ve birleşmiş
-- adın yeniden kullanılması MEŞRUDUR (base.service.ts §assertNameNotDuplicate).
-- RENK HARİÇ (bilinçli): renk mükerreri ayraç + token-sırası bağımsızdır
-- (`foldColorNameForCompare`, "055-BEYAZ" ≡ "BEYAZ 055"); düz `nameFold`
-- üzerine kısıt uygulama kuralından ZAYIF olur ve yanlış güven verir
-- (color.service.ts notu). Diğer 12 `nameFold` tablosu bugün temiz, uygulama
-- bekçisiyle temiz kalır; istenirse ileride backfill'siz eklenir.
--
-- AD: Prisma varsayılanı `<tablo>_nameFold_key` — şemadaki `@@unique([nameFold])`
-- aynı adı üretir (drift yok) ve error.middleware'in `_<kolon>_key` regex'i
-- kolonu doğru çıkarır. Prisma 7 partial predicate'i drift SAYMAZ.
--
-- ⚠️ BU MIGRATION MÜKERRER VARKEN DÜŞER — BİLİNÇLİ. Sıfırlama ertelenirse ya da
-- dolu bir kopyaya (saha yedeği) uygulanırsa aşağıdaki ön kontrol OKUNUR bir
-- hatayla durur; çözüm Tanımlar → Mükerrerler ile birleştirmektir, bu dosyayı
-- gevşetmek değil. Rapor: `npx tsx scripts/find_fold_duplicates.ts`.
-- `statement_timeout` GEREKMEZ: master-data tabloları küçük (yüzlerce satır).
-- =============================================================================

-- 0) Ön kontrol — mükerrer varsa CREATE UNIQUE INDEX'in "Key ... is duplicated"
--    mesajından önce düzeltme adresini de söyleyen bir hata. Boş DB'de no-op.
DO $pre$
DECLARE dup text;
BEGIN
  SELECT string_agg(t || ' → ' || k, ' ; ' ORDER BY t, k) INTO dup FROM (
    SELECT 'customers' AS t, "nameFold" AS k FROM customers
     WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*) > 1
    UNION ALL
    SELECT 'items', "nameFold" FROM items
     WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*) > 1
    UNION ALL
    SELECT 'subcontractors', "nameFold" FROM subcontractors
     WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*) > 1
  ) s;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'nameFold mükerrerleri var — önce birleştirin (Tanımlar → Mükerrerler | npx tsx scripts/find_fold_duplicates.ts): ' || dup,
      HINT = 'Bu migration bilinçli olarak mükerrer varken düşer (20260821150000_name_fold_unique_live).';
  END IF;
END
$pre$;

-- 1) Partial UNIQUE — tombstone'lar (mergedIntoId IS NOT NULL) kapsam dışı.
CREATE UNIQUE INDEX IF NOT EXISTS "customers_nameFold_key"
  ON "customers" ("nameFold") WHERE "mergedIntoId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "items_nameFold_key"
  ON "items" ("nameFold") WHERE "mergedIntoId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "subcontractors_nameFold_key"
  ON "subcontractors" ("nameFold") WHERE "mergedIntoId" IS NULL;
