-- =============================================================================
-- RENK AD MÜKERRERİ — DB SEDDİ, uygulama kuralının SQL İKİZİ üzerinde · 2026-08-25
-- =============================================================================
-- NEDEN düz `nameFold` DEĞİL: `customers/items/subcontractors` seddi düz `nameFold`
-- üzerindedir (20260821150000_name_fold_unique_live). Renkte bu ZAYIF olurdu:
-- renk mükerreri AYRAÇ ve SAYI-SIRASI bağımsızdır ("055-BEYAZ" ≡ "BEYAZ 055",
-- `foldColorNameForCompare` — name-normalize.helper.ts). Düz `nameFold` bu ikisini
-- FARKLI sayar → mükerrer geçer ama "sed kuruldu" görüntüsü verir (yanlış güven).
-- Bu yüzden kısıt `tr_fold_color(name)` İFADESİ üzerine kurulur: JS kuralının
-- birebir SQL ikizi. Parite bekçisi: `scripts/test_fold_contract.ts` §2b (tüm BMP).
--
-- NEYİ KAPATIR (uygulama bekçisi `ColorService.assertNameAvailable` check-then-act):
--   yarış · servisi atlayan yazım (script/elle SQL/geri yükleme) · içe aktarım
--   adaptörünün guard beyan etmemesi. Bekçi KALIR — Türkçe, kod bilgili 409'u o
--   verir; kısıt sessiz son hattır (P2002 → error.middleware `nameFoldColor`→"ad").
--
-- ⚠️ AYIRICI SINIFI AÇIK YAZILDI, `\s` DEĞİL: JS `foldColorNameForCompare` ayracı
-- JS `\s` ile böler (NBSP U+00A0, U+2000-200A, U+2028/29, U+202F, U+205F, U+3000,
-- U+FEFF dahil). PostgreSQL `\s` = `[[:space:]]` ve ASCII dışı davranışı
-- veritabanının ctype'ına BAĞLIDIR (dev ICU/en_US ↔ saha C locale) — aynı ad iki
-- kurulumda farklı katlanırdı. Liste JS `\s`'nin tam kümesidir; JS tarafı
-- değişirse burası da değişir (parite bekçisi ayrışmayı yakalar).
--
-- `tr_fold` STRICT + IMMUTABLE (20260819060000_search_fold) → bu da öyle; ifade
-- index'i için IMMUTABLE ŞART. Boş metin → '' (JS: filter(Boolean) → [] → "").
--
-- PREDICATE `"mergedIntoId" IS NULL`: birleştirme tombstone'u aynı adı meşru
-- taşır (diğer üç seddin emsali). `isActive` süzgeci YOK — pasif eş de adı tutar;
-- uygulama bekçisi pasif eşe "aktifleştirin" 409'u verir.
--
-- YUMUŞAK KAPI (name_fold_unique_live emsali): mükerrer grup varsa index'i ATLAR,
-- NOTICE basar, deploy'u DÜŞÜRMEZ. Temizlik (Sistem → Mükerrer Kayıtlar) sonrası
-- AYNI DOSYA yeniden koşulur (idempotent — IF NOT EXISTS):
--     npx prisma db execute --file prisma/migrations/20260825120000_color_name_unique_live/migration.sql
-- Ön kontrol: `npx tsx scripts/find_fold_duplicates.ts` (renk artık RENK kuralıyla
-- gruplanır). Index eksikken `scripts/test_db_invariants.ts` §5 KIRMIZI verir —
-- bilerek ("enforce bekliyor" sinyali). Prod'da 2026-08-25'te 0 grup ölçüldü →
-- ilk deploy'da kurulur.
--
-- Prisma bu index'i datamodel'de TEMSİL EDEMEZ ama `migrate diff` ifade/partial
-- index'i DROP etmeye de kalkmaz (users_username_lower_uq emsali; test_schema_drift
-- allowlist'e girdi GEREKMEZ — ölçüldü). `statement_timeout` gerekmez: `colors`
-- onlarca satır.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tr_fold_color(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
  SELECT coalesce(
    (SELECT string_agg(t, ' ' ORDER BY (t ~ '^[0-9]+$') DESC, ord)
       FROM unnest(regexp_split_to_array(
              public.tr_fold($1),
              '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff-]+'
            )) WITH ORDINALITY AS u(t, ord)
      WHERE t <> ''),
    '');
$fn$;

DO $sed$
DECLARE
  n_dup  integer;
  dups   text;
BEGIN
  -- Tombstone (mergedIntoId dolu) predicate dışıdır → sayılmaz.
  SELECT count(*), string_agg(k, ' ; ' ORDER BY k)
    INTO n_dup, dups
    FROM (SELECT public.tr_fold_color("name") AS k
            FROM "colors" WHERE "mergedIntoId" IS NULL
           GROUP BY 1 HAVING count(*) > 1) s;
  IF n_dup > 0 THEN
    RAISE NOTICE '[color_name_unique] colors ATLANDI — % mükerrer grup (%). Temizlik: Sistem → Mükerrer Kayıtlar ya da scripts/find_fold_duplicates.ts; sonra bu dosyayı yeniden koş.',
      n_dup, dups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "colors_nameFoldColor_key"
      ON "colors" (public.tr_fold_color("name")) WHERE "mergedIntoId" IS NULL;
    RAISE NOTICE '[color_name_unique] colors → colors_nameFoldColor_key kuruldu/zaten vardı.';
  END IF;
END
$sed$;
