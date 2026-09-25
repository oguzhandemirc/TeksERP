-- =============================================================================
-- ÜRÜN ARŞİV KAPISININ DB SEDDİ — docs/design/URUN-YASAM-DONGUSU.md §7 (S5)
-- =============================================================================
-- D1: Pasif (ARCHIVED) kartta canlı referans OLAMAZ. Uygulama kapısı (`assertItemUsable`
-- + yaşam döngüsü yazıcısı, FOR SHARE/FOR UPDATE) bunu bugün sağlıyor; bu sed, kapıyı
-- atlayan bir yolun (ham SQL, gelecekte yazılan bir servis, geri alma) kartı sessizce
-- kirletmesini DB'de durdurur. ADDITIVE — veri değiştirmez; mevcut satırlar yeniden
-- denetlenmez (tetikleyici yalnız INSERT ve ilgili kolonların UPDATE'inde koşar).
--
-- CANLI satır engellenir, TARİHÇE satırı geçer: birleştirme geri alması Pasif karta ÖLÜ
-- topları / kapalı kalemleri geri yazabilmelidir. Ölü top kümesi TS ikizi
-- `live-ref-where.helper` → `DEAD_ROLL_STATUSES` (bekçi `test_item_archive_db_guard` iki
-- tanımı karşılaştırır).
--
-- Hata SQLSTATE 23514 + kısıt adı mesajda → `error.middleware` CHECK eşlemesi 409 + Türkçe.
-- İdempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =============================================================================

CREATE OR REPLACE FUNCTION rolls_archived_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- Ölü top Pasif kartta durabilir (tarihçe, birleştirme geri alması).
  IF NEW.status IN ('SUBCONTRACTOR_CONSUMED', 'TAMBUR_CONSUMED', 'KARTELA_CONSUMED', 'CANCELLED', 'SHIPPED', 'SCRAP') THEN
    RETURN NEW;
  END IF;
  -- Kart değişmedi ve top zaten canlıydı: yeni canlı referans doğmuyor.
  IF TG_OP = 'UPDATE' AND NEW."itemId" = OLD."itemId"
     AND OLD.status NOT IN ('SUBCONTRACTOR_CONSUMED', 'TAMBUR_CONSUMED', 'KARTELA_CONSUMED', 'CANCELLED', 'SHIPPED', 'SCRAP') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "items" i WHERE i.id = NEW."itemId" AND i."lifecycleStatus" = 'ARCHIVED') THEN
    RAISE EXCEPTION 'new row for relation "rolls" violates check constraint "rolls_item_not_archived"'
      USING ERRCODE = '23514',
            DETAIL = 'Pasif (arşivlenmiş) kartta canlı top olamaz (URUN-YASAM-DONGUSU D1).';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION order_lines_archived_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- İptal edilmiş kalem tarihçedir.
  IF NEW."cancelledAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Kart değişmedi ve kalem zaten açıktı: yeni canlı referans doğmuyor.
  IF TG_OP = 'UPDATE' AND NEW."itemId" = OLD."itemId" AND OLD."cancelledAt" IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "items" i WHERE i.id = NEW."itemId" AND i."lifecycleStatus" = 'ARCHIVED')
     AND EXISTS (SELECT 1 FROM "orders" o WHERE o.id = NEW."orderId"
                  AND o.status IN ('PENDING', 'APPROVED', 'PARTIAL_SHIPPED')) THEN
    RAISE EXCEPTION 'new row for relation "order_lines" violates check constraint "order_lines_item_not_archived"'
      USING ERRCODE = '23514',
            DETAIL = 'Pasif (arşivlenmiş) kartta açık sipariş kalemi olamaz (URUN-YASAM-DONGUSU D1).';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "rolls_item_not_archived" ON "rolls";
CREATE TRIGGER "rolls_item_not_archived"
  BEFORE INSERT OR UPDATE OF "itemId", "status" ON "rolls"
  FOR EACH ROW EXECUTE FUNCTION rolls_archived_item_guard();

DROP TRIGGER IF EXISTS "order_lines_item_not_archived" ON "order_lines";
CREATE TRIGGER "order_lines_item_not_archived"
  BEFORE INSERT OR UPDATE OF "itemId", "cancelledAt" ON "order_lines"
  FOR EACH ROW EXECUTE FUNCTION order_lines_archived_item_guard();
