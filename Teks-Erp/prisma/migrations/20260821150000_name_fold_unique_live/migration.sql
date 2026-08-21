-- =============================================================================
-- AD MÜKERRERİ DB SEDDİ — `nameFold` partial UNIQUE (3 tablo) · 2026-08-21
-- =============================================================================
-- NEDEN: Kullanıcı kararı D3 ("SAHIN" ≡ "ŞAHİN" → aynı kayıt) 2026-08-19'da
-- uygulama katmanında geldi (`assertNameNotDuplicate` + `nameFold` gölge
-- kolonu) ama DB kısıtı BİLİNÇLİ OLARAK KONMADI: canlıda gerçek mükerrerler
-- vardı (customers 1 · items 4 · subcontractors 3 grup) ve UNIQUE deploy anında
-- düşerdi (`20260819060000_search_fold` §6).
--
-- ⚠️ 2026-08-22 DEĞİŞİKLİK — YUMUŞAK KAPI (expand → backfill → contract):
-- İlk sürüm "mükerrer varken RAISE EXCEPTION" idi çünkü plan 2026-08-22 DB
-- sıfırlamasıydı. Sıfırlama RAFA KALKTI; bu hâliyle dosya prod'daki HER deploy'u
-- (29, 30 ve sonrası dahil) mükerrerler birleştirilene dek bloke ederdi. Kısıt,
-- veri temizlenmeden aynı sürümde gelmez (sektör kuralı): bu yüzden dosya artık
-- tablo tablo bakar — MÜKERRER YOKSA index'i kurar, VARSA `RAISE NOTICE` ile
-- ATLAR (deploy geçer). Temiz ortamlarda (dev/CI/taze kurulum) sed anında gelir;
-- prod'da temizlik (Sistem → Mükerrer Kayıtlar paneli) bitince AYNI DOSYA tekrar
-- koşulur ve eksik index'i kurar (idempotent — IF NOT EXISTS):
--     npx prisma db execute --file prisma/migrations/20260821150000_name_fold_unique_live/migration.sql
-- Ön kontrol: `npx tsx scripts/find_fold_duplicates.ts` (sedli tablolar boş dönmeli).
-- Prod'da index'in EKSİK olduğu sürece `scripts/test_db_invariants.ts` §1 KIRMIZI
-- verir — bilerek: "sed bekliyor" sinyali unutulmasın. Bu dosya prod'a HİÇ
-- uygulanmadığı için düzenlendi (`search_fold` emsali); dev checksum'ı
-- `_prisma_migrations` satırı silinip `migrate resolve --applied` ile yenilendi.
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
-- (color.service.ts notu). Diğer 12 `nameFold` tablosu uygulama bekçisiyle
-- korunur; istenirse ileride aynı desenle eklenir.
--
-- AD: Prisma varsayılanı `<tablo>_nameFold_key` — şemadaki `@@unique([nameFold])`
-- aynı adı üretir (drift yok; Prisma 7 partial predicate'i drift SAYMAZ) ve
-- error.middleware'in `_<kolon>_key` regex'i kolonu doğru çıkarır.
-- `statement_timeout` GEREKMEZ: master-data tabloları küçük (yüzlerce satır).
-- =============================================================================

DO $sed$
DECLARE
  t      text;
  dups   text;
  n_dup  integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','items','subcontractors'] LOOP
    -- Tombstone (mergedIntoId dolu) predicate dışıdır → sayılmaz.
    EXECUTE format(
      'SELECT count(*), string_agg(k, '' ; '' ORDER BY k) FROM (
         SELECT "nameFold" AS k FROM %I WHERE "mergedIntoId" IS NULL
          GROUP BY 1 HAVING count(*) > 1) s', t)
      INTO n_dup, dups;
    IF n_dup > 0 THEN
      RAISE NOTICE '[name_fold_unique] % ATLANDI — % mükerrer grup (%). Temizlik: Sistem → Mükerrer Kayıtlar ya da scripts/find_fold_duplicates.ts; sonra bu dosyayı yeniden koş.',
        t, n_dup, dups;
    ELSE
      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I ("nameFold") WHERE "mergedIntoId" IS NULL',
        t || '_nameFold_key', t);
      RAISE NOTICE '[name_fold_unique] % → %_nameFold_key kuruldu/zaten vardı.', t, t;
    END IF;
  END LOOP;
END
$sed$;
