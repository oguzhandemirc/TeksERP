-- =============================================================================
-- K2 — Kartela durum seddi: status ↔ (sackId, shipmentId, cancelledAt) çift yüklemi
-- Tasarım: docs/design/KARTELA-HAREKET-DEFTERI.md §5.1, §5.7
-- =============================================================================
-- K2 ile kartelanın yer kolonlarını yalnız tek yazar (`helpers/swatch-event.helper.ts`)
-- yazar; status ve kolonlar artık birlikte değişir. Bu dosya ikisini DB'de bağlar.
--
-- ① Durum yeniden türetilir — K1 kuralının AYNISI (K1 ile K2 arasında eski yazarlar
--    status'a dokunmadan sackId/shipmentId yazmış olabilir). Statüsü değişen satırın
--    `statusChangedAt`ı NULL'a çekilir: an bilinmiyor, göç anı basılmaz.
-- ② CHECK `swatches_status_shape` NOT VALID eklenir: yeni ve güncellenen her satır
--    ölçülür; eski satır bu adımda taranmaz.
-- ③ İhlalli satır YOKSA CHECK aynı dosyada VALIDATE edilir. Varsa deploy DURMAZ,
--    NOTICE kuru script'in adını basar ve validate edilmemiş kısıt
--    `/api/admin/health` → `unvalidatedConstraints` alanında görünür.
--    ⚠️ NOT VALID kısıt, ihlalli eski satıra yapılan HER UPDATE'i reddeder.
-- GÜVENLİ / ADDITIVE: yeni kolon/tablo yok; satır silinmez, defter satırı yazılmaz.
-- =============================================================================

UPDATE "swatches" sw
SET "status" = d."turetilen", "statusChangedAt" = NULL
FROM (
  SELECT s."id", (CASE
      WHEN s."cancelledAt" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "swatch_stock_reduction_items" i
        JOIN "swatch_stock_reductions" r ON r."id" = i."reductionId"
        WHERE i."swatchId" = s."id" AND r."reversedAt" IS NULL) THEN 'REDUCED'
      WHEN s."cancelledAt" IS NOT NULL THEN 'VOIDED'
      WHEN s."shipmentId" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "shipments" sh
        WHERE sh."id" = s."shipmentId" AND sh."status" = 'DISPATCHED') THEN 'SHIPPED'
      WHEN s."shipmentId" IS NOT NULL THEN 'IN_SHIPMENT'
      WHEN s."sackId" IS NOT NULL THEN 'IN_SACK'
      ELSE 'IN_STOCK'
    END)::"SwatchStatus" AS "turetilen"
  FROM "swatches" s
) d
WHERE d."id" = sw."id" AND sw."status" <> d."turetilen";

DO $$ BEGIN
  ALTER TABLE "swatches" ADD CONSTRAINT "swatches_status_shape"
    CHECK (CASE "status"
      WHEN 'IN_STOCK'    THEN "sackId" IS NULL     AND "shipmentId" IS NULL     AND "cancelledAt" IS NULL
      WHEN 'IN_SACK'     THEN "sackId" IS NOT NULL AND "shipmentId" IS NULL     AND "cancelledAt" IS NULL
      WHEN 'IN_SHIPMENT' THEN "sackId" IS NOT NULL AND "shipmentId" IS NOT NULL AND "cancelledAt" IS NULL
      WHEN 'SHIPPED'     THEN "sackId" IS NOT NULL AND "shipmentId" IS NOT NULL AND "cancelledAt" IS NULL
      WHEN 'REDUCED'     THEN "sackId" IS NULL     AND "shipmentId" IS NULL     AND "cancelledAt" IS NOT NULL
      WHEN 'VOIDED'      THEN "sackId" IS NULL     AND "shipmentId" IS NULL     AND "cancelledAt" IS NOT NULL
      ELSE false
    END) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE ihlal integer;
BEGIN
  SELECT count(*) INTO ihlal FROM "swatches" WHERE NOT (CASE "status"
      WHEN 'IN_STOCK'    THEN "sackId" IS NULL     AND "shipmentId" IS NULL     AND "cancelledAt" IS NULL
      WHEN 'IN_SACK'     THEN "sackId" IS NOT NULL AND "shipmentId" IS NULL     AND "cancelledAt" IS NULL
      WHEN 'IN_SHIPMENT' THEN "sackId" IS NOT NULL AND "shipmentId" IS NOT NULL AND "cancelledAt" IS NULL
      WHEN 'SHIPPED'     THEN "sackId" IS NOT NULL AND "shipmentId" IS NOT NULL AND "cancelledAt" IS NULL
      WHEN 'REDUCED'     THEN "sackId" IS NULL     AND "shipmentId" IS NULL     AND "cancelledAt" IS NOT NULL
      WHEN 'VOIDED'      THEN "sackId" IS NULL     AND "shipmentId" IS NULL     AND "cancelledAt" IS NOT NULL
      ELSE false
    END);
  IF ihlal = 0 THEN
    ALTER TABLE "swatches" VALIDATE CONSTRAINT "swatches_status_shape";
  ELSE
    RAISE NOTICE 'swatches_status_shape VALIDATE EDİLMEDİ: % kartela kolon hâli durumla çelişiyor. Kayıt kayıt döküm: npx tsx scripts/kartela_durum_anomali.ts (kuru). Düzeltme --apply kullanıcıda.', ihlal;
  END IF;
END $$;
