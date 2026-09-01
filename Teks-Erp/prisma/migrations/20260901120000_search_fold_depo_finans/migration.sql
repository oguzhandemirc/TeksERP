-- =============================================================================
-- ARAMA KATLAMASI — DEPO + ÖN MUHASEBE TABLOLARI (2026-09-01)
-- =============================================================================
-- `20260819060000_search_fold` arama motorunu katlanmış gölge kolonlara taşıdı:
-- bir metin alanı `searchFields`e yazıldığında motor `<kolon>Fold` gölgesini
-- sorgular. O migration `adnansahin` dalında yazıldı ve o dalda VAR OLAN
-- tabloları kapsıyordu.
--
-- Depo mal kabul + ön muhasebe tabloları BAŞKA bir dalda (feature/depo-mal-kabul)
-- ve fold mimarisinden ÖNCE yazıldı. Birleştirmede iki taraf yan yana geldi:
-- arama motoru yeni, tablolar eski → `searchFields` var olmayan bir kolona
-- soruyordu ve Prisma isteği REDDEDİYORDU.
--
-- ⚠️ Belirti SESSİZ DEĞİL, ama teşhisi yanıltıcıydı: liste ilk açılışta (arama
-- boşken) sorunsuz geliyor, kullanıcı arama kutusuna İLK HARFİ yazınca 500
-- düşüyordu. Ölçüldü (2026-09-01, yerel birleşik dal): 5 tablonun 5'i.
--   • warehouses        → codeFold YOK        (Depolar listesi)
--   • goods_receipts    → receiptNoFold YOK   (Mal Kabul listesi)
--   • warehouse_transfers → transferNoFold YOK (Depo Transferi listesi)
--   • cash_boxes        → codeFold YOK        (Kasa listesi)
--   • bank_accounts     → codeFold YOK        (Banka Hesapları listesi)
-- Ayrıca `BaseService.findSimilarNames` (mükerrer ad uyarısı) `nameFold` okuduğu
-- için depo/kasa/banka OLUŞTURMA da patlıyordu — yalnız arama değil.
--
-- ÇÖZÜM İKİ BACAKLI (ikisi de gerekli, biri diğerinin yerine geçmez):
--   1) KOD alanları (`code`, `receiptNo`, `deliveryNoteNo`, `transferNo`, `iban`)
--      servis yapılandırmasında `codeSearchFields` kovasına taşındı — bunlar
--      KATLANMAZ (ASCII/boşluksuz saklanır), gölge kolon İSTEMEZLER.
--   2) Gerçek serbest metin alanları (`name`, `address`, `notes`, `bankName`)
--      bu migration ile gölge kolonlarını alır.
--
-- ⚠️ `public.tr_fold` ÖN KOŞULDUR — `20260819060000_search_fold` onu yaratır ve
--    o migration bu dosyadan ÖNCE koşar (sıra dizin adından gelir). Fonksiyon
--    IMMUTABLE olduğu için GENERATED STORED ifadesinde kullanılabilir.
--
-- ⚠️ GIN/trigram index KOYULMADI — bilinçli. `20260819060000` GIN'i yalnız
--    yüksek hacimli 9 kolona verdi (31 gölge kolonun 9'u); bunlar birkaç yüz
--    satırlık ana veri / fiş tabloları, düz B-tree emsalle tutarlı ve ucuz.
--    Hacim büyürse GIN ayrı bir migration'la eklenir.
--
-- Geri alma:
--   ALTER TABLE "warehouses"          DROP COLUMN "nameFold", DROP COLUMN "addressFold", DROP COLUMN "notesFold";
--   ALTER TABLE "warehouse_transfers" DROP COLUMN "notesFold";
--   ALTER TABLE "goods_receipts"      DROP COLUMN "notesFold";
--   ALTER TABLE "cash_boxes"          DROP COLUMN "nameFold";
--   ALTER TABLE "bank_accounts"       DROP COLUMN "nameFold", DROP COLUMN "bankNameFold";
--   (index'ler kolonla birlikte düşer)
-- =============================================================================

-- ── 1) Gölge kolonlar ───────────────────────────────────────────────────────
ALTER TABLE "warehouses"
  ADD COLUMN "nameFold"    text GENERATED ALWAYS AS (public.tr_fold("name"))    STORED,
  ADD COLUMN "addressFold" text GENERATED ALWAYS AS (public.tr_fold("address")) STORED,
  ADD COLUMN "notesFold"   text GENERATED ALWAYS AS (public.tr_fold("notes"))   STORED;

ALTER TABLE "warehouse_transfers"
  ADD COLUMN "notesFold" text GENERATED ALWAYS AS (public.tr_fold("notes")) STORED;

ALTER TABLE "goods_receipts"
  ADD COLUMN "notesFold" text GENERATED ALWAYS AS (public.tr_fold("notes")) STORED;

ALTER TABLE "cash_boxes"
  ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;

ALTER TABLE "bank_accounts"
  ADD COLUMN "nameFold"     text GENERATED ALWAYS AS (public.tr_fold("name"))     STORED,
  ADD COLUMN "bankNameFold" text GENERATED ALWAYS AS (public.tr_fold("bankName")) STORED;

-- ── 2) Index'ler (Prisma adlandırma sözleşmesi: <tablo>_<kolon>_idx) ────────
CREATE INDEX "warehouses_nameFold_idx"          ON "warehouses" ("nameFold");
CREATE INDEX "warehouses_addressFold_idx"       ON "warehouses" ("addressFold");
CREATE INDEX "warehouses_notesFold_idx"         ON "warehouses" ("notesFold");
CREATE INDEX "warehouse_transfers_notesFold_idx" ON "warehouse_transfers" ("notesFold");
CREATE INDEX "goods_receipts_notesFold_idx"     ON "goods_receipts" ("notesFold");
CREATE INDEX "cash_boxes_nameFold_idx"          ON "cash_boxes" ("nameFold");
CREATE INDEX "bank_accounts_nameFold_idx"       ON "bank_accounts" ("nameFold");
CREATE INDEX "bank_accounts_bankNameFold_idx"   ON "bank_accounts" ("bankNameFold");
