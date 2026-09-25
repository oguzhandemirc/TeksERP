-- =============================================================================
-- ÜRÜN KARTI YAŞAM DÖNGÜSÜ — docs/design/URUN-YASAM-DONGUSU.md §7
-- =============================================================================
-- ADDITIVE şema + tek seferlik backfill. Bugünkü tek boolean (`isActive`) iki anlam
-- taşıyordu; üç durum doğar: ACTIVE (Aktif) · PHASE_OUT (Tükenene kadar) · ARCHIVED
-- (Pasif). `isActive` KALIR ve durumdan TÜRER: isActive = (lifecycleStatus <> 'ARCHIVED'),
-- DB CHECK seddiyle (çift yüklem kuralı). Eski okuyucular ve nameFold partial unique'i
-- (WHERE "mergedIntoId" IS NULL) etkilenmez.
--
-- ⚠️ BACKFILL DAVRANIŞ DEĞİŞTİRİR (kullanıcı kararı 2026-09-25, belge §14/3):
-- pasif AMA canlı referanslı kart PHASE_OUT olur ve `isActive` true'ya döner — üstündeki
-- mal yeniden akar. Aynı sürüm `assertItemUsable` taşımasını taşır (sıra şartı §7);
-- yeni sipariş/stok girişi kapıda reddedilir. Etkilenen kartlar sürüm notunda ADIYLA.
--
-- CANLI REFERANS (D1) buradaki EXISTS kümesidir; TS ikizi
-- `src/services/helpers/item-lifecycle.helper.ts` → `ITEM_LIVE_REF_SOURCES`. İkisi aynı
-- kartları saymak ZORUNDA — `scripts/test_item_lifecycle_migration.ts` karşılaştırır.
--
-- İdempotent: ikinci koşum hiçbir satırı değiştirmez (her UPDATE hedef durumu dışlar).
-- =============================================================================

DO $tip$
BEGIN
  CREATE TYPE "ItemLifecycleStatus" AS ENUM ('ACTIVE', 'PHASE_OUT', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$tip$;

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "lifecycleStatus" "ItemLifecycleStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "lifecycleChangedAt" TIMESTAMPTZ;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "lifecycleChangedById" UUID;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "lifecycleReason" VARCHAR(500);

ALTER TABLE "merge_operation_sources" ADD COLUMN IF NOT EXISTS "lifecycleBefore" "ItemLifecycleStatus";

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_lifecycleChangedById_fkey') THEN
    ALTER TABLE "items" ADD CONSTRAINT "items_lifecycleChangedById_fkey"
      FOREIGN KEY ("lifecycleChangedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$fk$;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- 1) Birleştirilmiş kart = mezar taşı → ARCHIVED (bugünkü davranış aynen).
UPDATE "items"
   SET "lifecycleStatus" = 'ARCHIVED', "isActive" = false
 WHERE "mergedIntoId" IS NOT NULL
   AND "lifecycleStatus" <> 'ARCHIVED';

-- 2) Pasif + canlı referanslı → PHASE_OUT (mal akar; yeni talep/stok kapıda durur).
UPDATE "items" i
   SET "lifecycleStatus" = 'PHASE_OUT',
       "isActive" = true,
       "lifecycleChangedAt" = now(),
       "lifecycleReason" = 'Sürüm göçü: pasif kartta canlı kayıt vardı — Tükenene kadar''a alındı'
 WHERE i."isActive" = false
   AND i."mergedIntoId" IS NULL
   AND i."lifecycleStatus" = 'ACTIVE'
   AND (
        -- D1-BASLA (bekçi bu blok arasını okur; alias "i" = items)
        EXISTS (SELECT 1 FROM "rolls" r
                 WHERE r."itemId" = i.id
                   AND r.status NOT IN ('SUBCONTRACTOR_CONSUMED', 'TAMBUR_CONSUMED', 'KARTELA_CONSUMED',
                                        'CANCELLED', 'SHIPPED', 'SCRAP'))
     OR EXISTS (SELECT 1 FROM "work_orders" w
                 WHERE w."targetItemId" = i.id AND w.status IN ('PLANNED', 'IN_PROGRESS'))
     OR EXISTS (SELECT 1 FROM "order_lines" ol JOIN "orders" o ON o.id = ol."orderId"
                 WHERE ol."itemId" = i.id
                   AND ol."cancelledAt" IS NULL
                   AND o.status IN ('PENDING', 'APPROVED', 'PARTIAL_SHIPPED')
                   AND (ol.unit <> 'MT' OR ol.quantity > ol."shippedQty"))
     OR EXISTS (SELECT 1 FROM "purchase_order_lines" pl JOIN "purchase_orders" po ON po.id = pl."purchaseOrderId"
                 WHERE pl."itemId" = i.id AND po.status IN ('OPEN', 'PARTIAL') AND pl.qty > pl."receivedQty")
     OR EXISTS (SELECT 1 FROM "weaving_orders" wo
                 WHERE wo."itemId" = i.id AND wo.status IN ('PLANNED', 'IN_PROGRESS'))
     OR EXISTS (SELECT 1 FROM "machine_runs" mr
                 WHERE mr."itemId" = i.id AND mr."endedAt" IS NULL AND mr."revokedAt" IS NULL)
     OR EXISTS (SELECT 1 FROM "subcontractor_dispatch_items" di
                  JOIN "subcontractor_dispatches" d ON d.id = di."dispatchId"
                 WHERE di."yarnItemId" = i.id
                   AND di."remainderClosedAt" IS NULL
                   AND d."cancelledAt" IS NULL
                   AND d."directShippedAt" IS NULL)
     OR EXISTS (SELECT 1 FROM "yarn_stocks" ys
                 WHERE ys."itemId" = i.id AND ys."balanceKg" <> 0)
        -- D1-BITTI
   );

-- 3) Kalan pasifler → ARCHIVED (canlı referansı yok; bugünkü "pasif" aynen).
UPDATE "items"
   SET "lifecycleStatus" = 'ARCHIVED'
 WHERE "isActive" = false
   AND "lifecycleStatus" = 'ACTIVE';

-- ── Sed: isActive durumdan türer ────────────────────────────────────────────
DO $ck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_lifecycle_isactive_ck') THEN
    ALTER TABLE "items" ADD CONSTRAINT "items_lifecycle_isactive_ck"
      CHECK (("lifecycleStatus" = 'ARCHIVED') = (NOT "isActive"));
  END IF;
END
$ck$;
