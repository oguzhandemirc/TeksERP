-- =============================================================================
-- DEVERE SEDLERİ — kısmi index + iki CHECK (Faz 1a kapanışı)
-- =============================================================================
-- Üçü de uygulama guard'ının AYNASI DEĞİL: uygulamanın hiç bakmadığı yolları
-- (elle SQL · içe aktarım · yarım profil uygulaması · eski dump) kapatan son hat.
--
-- ⚠️ TEK DOSYA — `NOT VALID` + ayrı validate İKİLİSİ KULLANILMADI ve bu bir
-- EMSAL DEĞİLDİR. Evin genel kalıbı `NOT VALID` + ikinci dosyada VALIDATE'tir
-- (emsal: 20260912150200 / 20260912150300). Burada atlanmasının TEK sebebi
-- ÖLÇÜLMÜŞ SIFIR HACİMDİR — fabrika kopyasında salt-okunur ölçüm:
--   warp_specs            → 0 satır
--   items                 → 245 satır, "warpSpecId" DOLU olan → 0
--   selvedge ihlali       → 0
--   reed ihlali           → 0
-- Doğrulanacak satır olmadığı için uzun ACCESS EXCLUSIVE kilidi doğamaz; kalıbı
-- yine de kopyalamak, kısıtı doğrulanmamış bırakıp ikinci dosyayı unutma riski
-- üretirdi. DOLU bir tabloda bu dosya emsal alınmaz.
--
-- ŞEMA PROVASI: bir canlı dump üzerinde KOŞULDU (`tekserp_yeni_20260911`, custom
-- format, 125 tablo / 5.784 top) — restore → `migrate deploy` → bekçiler sırasıyla
-- ve `test_db_invariants` o veritabanında 171/0 verdi. EN ESKİ canlı kurulumun
-- dump'ı üzerindeki tekrarı YAYIN TURUNUN adımıdır (dump kullanıcının ortamında);
-- bu migration'ın riski ölçülmüş sıfır olduğu için commit'i bloklamaz.
-- =============================================================================

-- ① KISMİ INDEX — null-yoğun FK.
-- `items."warpSpecId"` bugün HER kumaş kaleminde boş (yazan yüzey Faz 1b'de
-- doğacak) ve devere kapalı kurulumlarda kalıcı olarak boş kalır. Tam index her
-- satır için giriş tutar, kısmi index yalnız bağlı olanları. Emsal AYNI tabloda:
-- `items_mergedIntoId_idx` (envanterdeki gerekçe birebir aynı sınıf).
DROP INDEX IF EXISTS "items_warpSpecId_idx";
CREATE INDEX "items_warpSpecId_idx" ON "items" ("warpSpecId") WHERE "warpSpecId" IS NOT NULL;

-- ② KENAR TELİ TOPLAMIN İÇİNDEDİR — şemanın kendi cümlesi, artık sed.
-- `selvedgeEnds > endsCount` yazılabiliyordu; levent kg hesabı (tel × denye ×
-- metre ÷ 9.000.000) o durumda sessizce saçmalar, hiçbir yerde hata görünmez.
ALTER TABLE "warp_specs"
  ADD CONSTRAINT "warp_specs_selvedge_sane"
  CHECK ("selvedgeEnds" IS NULL OR ("selvedgeEnds" >= 0 AND "selvedgeEnds" < "endsCount"));

-- ③ TARAK ALANLARI POZİTİF.
-- Üçü de bugün yalnız ekranda gösteriliyor ve `reedNo`nun BİRİMİ PROFİLDİR
-- (diş/cm ya da diş/10 cm), yani hesaba girmiyor — ama sıfır/negatif bir tarak
-- numarası hiçbir kurulumda anlamlı değildir ve ileride hesaba girerse bölendir.
ALTER TABLE "warp_specs"
  ADD CONSTRAINT "warp_specs_reed_positive"
  CHECK (
    ("reedNo" IS NULL OR "reedNo" > 0)
    AND ("endsPerDent" IS NULL OR "endsPerDent" > 0)
    AND ("reedWidthCm" IS NULL OR "reedWidthCm" > 0)
  );
