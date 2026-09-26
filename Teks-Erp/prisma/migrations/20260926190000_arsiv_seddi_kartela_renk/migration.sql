-- =============================================================================
-- ARŞİV SEDDİ — kartela × ürün, top × renk, kartela × renk (MV-06; top × ürün seddinin ikizleri)
-- =============================================================================
-- Pasif (ARCHIVED) ürün kartında ve pasif renkte CANLI top/kartela olamaz. Uygulama kapısı
-- (`assertRollsRevivable` · `assertSwatchesRevivable`, renk ayağıyla) bunu sağlıyor; bu sed kapıyı
-- atlayan yolu (ham SQL, script, tek yazarı atlayan kod) DB'de durdurur. Emsal
-- `20260925200000_urun_arsiv_db_seddi` (`rolls_item_not_archived`).
--
-- CANLI satır engellenir, TARİHÇE satırı geçer (ölü kayıt pasif kartta/renkte durabilir; birleştirme
-- geri alması mezar taşını ÖNCE kaldırır). Kümeler TS ikizleriyle aynı: top ölü kümesi
-- `DEAD_ROLL_STATUSES`, kartela canlı kümesi `LIVE_SWATCH` (bekçi `test_arsiv_seddi_kartela_renk` §1).
-- Tetik yalnız kayıt canlı kümeye GİRERKEN ya da canlıyken kartı/rengi değişirken koşar.
--
-- Ölçüm (prova kopyaları, salt okuma): pasif renkte canlı top 0 (7 pasif renk, 8.381–9.025 top),
-- fabrikada kartela 0; ARCHIVED ürün durumu `lifecycleStatus` göçüyle doğar. ⇒ mevcut ihlal yok.
-- Hata SQLSTATE 23514 + kısıt adı mesajda → `error.middleware` CHECK eşlemesi 409 + Türkçe.
-- ADDITIVE, İDEMPOTENT: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; veri değişmez.
-- =============================================================================

CREATE OR REPLACE FUNCTION rolls_archived_color_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."colorId" IS NULL
     OR NEW.status IN ('SUBCONTRACTOR_CONSUMED', 'TAMBUR_CONSUMED', 'KARTELA_CONSUMED', 'CANCELLED', 'SHIPPED', 'SCRAP') THEN
    RETURN NEW;
  END IF;
  -- Renk değişmedi ve top zaten canlıydı: yeni canlı referans doğmuyor.
  IF TG_OP = 'UPDATE' AND NEW."colorId" IS NOT DISTINCT FROM OLD."colorId"
     AND OLD.status NOT IN ('SUBCONTRACTOR_CONSUMED', 'TAMBUR_CONSUMED', 'KARTELA_CONSUMED', 'CANCELLED', 'SHIPPED', 'SCRAP') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "colors" c WHERE c.id = NEW."colorId" AND NOT c."isActive") THEN
    RAISE EXCEPTION 'new row for relation "rolls" violates check constraint "rolls_color_not_archived"'
      USING ERRCODE = '23514',
            DETAIL = 'Pasif (arşivlenmiş) renkte canlı top olamaz (MV-06).';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION swatches_archived_master_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  giris boolean;
BEGIN
  IF NEW.status NOT IN ('IN_STOCK', 'IN_SACK', 'IN_SHIPMENT') THEN
    RETURN NEW;
  END IF;
  -- Canlı kümeye GİRİŞ (doğuş · dirilme); canlıyken yalnız kart/renk değişimi denetlenir.
  giris := TG_OP = 'INSERT' OR OLD.status NOT IN ('IN_STOCK', 'IN_SACK', 'IN_SHIPMENT');
  IF (giris OR NEW."itemId" <> OLD."itemId")
     AND EXISTS (SELECT 1 FROM "items" i WHERE i.id = NEW."itemId" AND i."lifecycleStatus" = 'ARCHIVED') THEN
    RAISE EXCEPTION 'new row for relation "swatches" violates check constraint "swatches_item_not_archived"'
      USING ERRCODE = '23514',
            DETAIL = 'Pasif (arşivlenmiş) kartta canlı kartela olamaz (MV-06).';
  END IF;
  IF NEW."colorId" IS NOT NULL AND (giris OR NEW."colorId" IS DISTINCT FROM OLD."colorId")
     AND EXISTS (SELECT 1 FROM "colors" c WHERE c.id = NEW."colorId" AND NOT c."isActive") THEN
    RAISE EXCEPTION 'new row for relation "swatches" violates check constraint "swatches_color_not_archived"'
      USING ERRCODE = '23514',
            DETAIL = 'Pasif (arşivlenmiş) renkte canlı kartela olamaz (MV-06).';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "rolls_color_not_archived" ON "rolls";
CREATE TRIGGER "rolls_color_not_archived"
  BEFORE INSERT OR UPDATE OF "colorId", "status" ON "rolls"
  FOR EACH ROW EXECUTE FUNCTION rolls_archived_color_guard();

DROP TRIGGER IF EXISTS "swatches_master_not_archived" ON "swatches";
CREATE TRIGGER "swatches_master_not_archived"
  BEFORE INSERT OR UPDATE OF "itemId", "colorId", "status" ON "swatches"
  FOR EACH ROW EXECUTE FUNCTION swatches_archived_master_guard();
