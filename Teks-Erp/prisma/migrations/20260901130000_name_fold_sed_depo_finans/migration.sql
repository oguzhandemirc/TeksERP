-- =============================================================================
-- AD MÜKERRERİ SEDDİ — depo / kasa / banka (2026-09-01)
-- =============================================================================
-- `20260901120000_search_fold_depo_finans` bu üç tabloya `nameFold` gölge
-- kolonunu ekledi ve o kolon iki işi birden görüyor:
--   1) arama (metin yolu),
--   2) **ad mükerrer kontrolü** — `BaseService.assertNameNotDuplicate` katlanmış
--      kolondan okur ve üç servis de `duplicateNameField: "name"` bildiriyor.
--
-- ⚠️ O kontrol KİLİTSİZ check-then-act'tir: `create()` transaction bile açmaz.
--    İki eşzamanlı istek aynı adı yazabilir ve uygulama guard'ı ikisini de
--    geçirir — yarışı kapatan tek şey DB seddidir. Bu yüzden `nameFold` kolonu
--    ekleyip sed eklememek SESSİZ bir boşluktur: normal yolda hiçbir şey
--    kırmızıya dönmez. Bekçi: `scripts/test_master_data_name_dup.ts` §10
--    ("her nameFold tablosu ya SEDLİ ya GEREKÇELİ MUAF", iki yönlü).
--
-- ⚠️ NEDEN PARTIAL DEĞİL (customers/items/subcontractors'tan farkı): o üç tablo
--    ana veri BİRLEŞTİRMESİNE katılır ve mezar taşı (`mergedIntoId`) satırları
--    aynı adı MEŞRUEN taşımaya devam eder → sed `WHERE "mergedIntoId" IS NULL`
--    ile daraltılmıştı. Depo/kasa/banka birleştirmeye KATILMAZ, `mergedIntoId`
--    kolonları YOKTUR; ayrıca uygulama guard'ı da hiçbir süzgeç uygulamıyor
--    (`duplicateNameWhere` verilmemiş). Sed uygulamanın AYNASI olmalı → düz
--    UNIQUE. (Pasif kaydı muaf tutmak sed'i guard'dan GEVŞEK yapardı ve
--    "uygulama reddediyor ama DB kabul ediyor" çelişkisini geri getirirdi.)
--
-- ⚠️ MEVCUT VERİ RİSKİ ÖLÇÜLDÜ, VARSAYILMADI: sahadaki fabrika kopyasında
--    (`tekserp_20260822_013613.dump`, 88 tablo) `warehouses`, `cash_boxes` ve
--    `bank_accounts` tabloları **HİÇ YOK** — fabrika çok-depo ve ön muhasebe
--    modüllerini kullanmıyor. Yükseltmede üç tablo da BOŞ doğar, yani bu sed
--    hiçbir mevcut satırı düşüremez. (customers/items sedleri bu lüksü
--    bulamamış ve önce bir temizlik script'i istemişti — bkz.
--    `20260830..._kumas_ad_kod_seddi`.)
--
-- Geri alma:
--   DROP INDEX "warehouses_nameFold_key";
--   DROP INDEX "cash_boxes_nameFold_key";
--   DROP INDEX "bank_accounts_nameFold_key";
--   CREATE INDEX "warehouses_nameFold_idx"    ON "warehouses" ("nameFold");
--   CREATE INDEX "cash_boxes_nameFold_idx"    ON "cash_boxes" ("nameFold");
--   CREATE INDEX "bank_accounts_nameFold_idx" ON "bank_accounts" ("nameFold");
-- =============================================================================

-- Düz index UNIQUE'e terfi ediyor → önce eskisi düşer (Prisma şemada artık
-- `@@unique([nameFold])` diyor; index↔unique farkı DRIFT sayılır).
DROP INDEX IF EXISTS "warehouses_nameFold_idx";
DROP INDEX IF EXISTS "cash_boxes_nameFold_idx";
DROP INDEX IF EXISTS "bank_accounts_nameFold_idx";

CREATE UNIQUE INDEX "warehouses_nameFold_key"    ON "warehouses" ("nameFold");
CREATE UNIQUE INDEX "cash_boxes_nameFold_key"    ON "cash_boxes" ("nameFold");
CREATE UNIQUE INDEX "bank_accounts_nameFold_key" ON "bank_accounts" ("nameFold");
