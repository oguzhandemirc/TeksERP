-- =============================================================================
-- K1 — Kartela olay defteri (defter doktrini)
-- Tasarım: docs/design/KARTELA-HAREKET-DEFTERI.md §5 (kullanıcı kararları S1–S6, 2026-09-26)
-- =============================================================================
-- Kartela (`swatches`) kendi kimliği ve ADET birimi olan ayrı bir varlıktır; bugün
-- "şu an ne"si kolonlarda, çuval/sevkiyat geçmişi ise hiçbir defterde yok.
--   • `swatches.status` + `statusChangedAt`: şu anki yer (durum kolonu).
--   • `swatch_events`: append-only olay defteri, bir satır = bir kartelanın bir geçişi.
--
-- GÜVENLİ / ADDITIVE: iki YENİ enum tipi, iki YENİ kolon, bir YENİ tablo, dört CHECK,
-- bir trigger. Mevcut satırlarda yalnız `status` doldurulur (kendi kolonlarından,
-- audit okunmaz). Geçmiş olay satırı ÜRETİLMEZ (S3: defter yayından sonra başlar).
-- status ↔ (sackId, shipmentId, cancelledAt) CHECK çifti K2'de gelir: eski yazarlar
-- tek yazara bağlanmadan o CHECK her çuval okutmasını kırardı.
-- ⚠️ Enumlar YENİ tip (`CREATE TYPE`) — ADD VALUE aynı-tx kısıtı burada geçerli değil.
-- ⚠️ `defter_block_tamper()` 20260925160000_roll_status_events'te doğar; burada TANIMLANMAZ.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "SwatchStatus" AS ENUM ('IN_STOCK', 'IN_SACK', 'IN_SHIPMENT', 'SHIPPED', 'REDUCED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SwatchEventType" AS ENUM
    ('BORN', 'VOIDED', 'SACKED', 'UNSACKED', 'SHIPMENT_ADDED', 'SHIPMENT_REMOVED',
     'SHIPPED', 'SHIP_UNDONE', 'REDUCED', 'REDUCTION_REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "swatches" ADD COLUMN IF NOT EXISTS "status" "SwatchStatus" NOT NULL DEFAULT 'IN_STOCK';
ALTER TABLE "swatches" ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMPTZ;

-- Durum backfill'i — YALNIZ kartelanın kendi kolonlarından ve bağlı belgelerinden.
-- İptal damgası iki anlam taşıyordu; canlı (stornosuz) düşüm kalemi varsa DÜŞÜM,
-- yoksa kabul iptali. Düşülmüş kartelanın kabulü sonradan iptal edilse de o kartela
-- düşülmüştür (kabul iptali yalnız iptal edilmemiş kartelaları iptal eder).
-- `statusChangedAt` NULL kalır: an bilinmiyor (defter öncesi).
UPDATE "swatches" sw
SET "status" = (CASE
    WHEN sw."cancelledAt" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "swatch_stock_reduction_items" i
      JOIN "swatch_stock_reductions" r ON r."id" = i."reductionId"
      WHERE i."swatchId" = sw."id" AND r."reversedAt" IS NULL) THEN 'REDUCED'
    WHEN sw."cancelledAt" IS NOT NULL THEN 'VOIDED'
    WHEN sw."shipmentId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "shipments" sh
      WHERE sh."id" = sw."shipmentId" AND sh."status" = 'DISPATCHED') THEN 'SHIPPED'
    WHEN sw."shipmentId" IS NOT NULL THEN 'IN_SHIPMENT'
    WHEN sw."sackId" IS NOT NULL THEN 'IN_SACK'
    ELSE 'IN_STOCK'
  END)::"SwatchStatus"
WHERE sw."cancelledAt" IS NOT NULL OR sw."shipmentId" IS NOT NULL OR sw."sackId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "swatch_events" (
  "id"              UUID NOT NULL,
  "swatchId"        UUID NOT NULL,
  "type"            "SwatchEventType" NOT NULL,
  "fromStatus"      "SwatchStatus",
  "toStatus"        "SwatchStatus" NOT NULL,
  "groupId"         UUID NOT NULL,
  "trigger"         VARCHAR(40) NOT NULL,
  "channel"         VARCHAR(16) NOT NULL,
  "reason"          VARCHAR(300),
  "reasonCode"      VARCHAR(64),
  "sackId"          UUID,
  "sackNo"          VARCHAR(64),
  "shipmentId"      UUID,
  "shipmentNo"      VARCHAR(64),
  "receiptId"       UUID,
  "reductionId"     UUID,
  "reversesEventId" UUID,
  "createdById"     UUID,
  "deviceId"        VARCHAR(128),
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "swatch_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "swatch_events_reversesEventId_key"
  ON "swatch_events" ("reversesEventId");
CREATE INDEX IF NOT EXISTS "swatch_events_swatchId_createdAt_idx"
  ON "swatch_events" ("swatchId", "createdAt");
CREATE INDEX IF NOT EXISTS "swatch_events_type_createdAt_idx"
  ON "swatch_events" ("type", "createdAt");
CREATE INDEX IF NOT EXISTS "swatch_events_groupId_idx"
  ON "swatch_events" ("groupId");

DO $$ BEGIN
  ALTER TABLE "swatch_events" ADD CONSTRAINT "swatch_events_reversesEventId_fkey"
    FOREIGN KEY ("reversesEventId") REFERENCES "swatch_events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "swatch_events" ADD CONSTRAINT "swatch_events_swatchId_fkey"
    FOREIGN KEY ("swatchId") REFERENCES "swatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DB seddi (şema-dışı → scripts/test_db_invariants.ts envanterinde)
DO $$ BEGIN
  ALTER TABLE "swatch_events" ADD CONSTRAINT "swatch_events_channel_known"
    CHECK ("channel" IN ('PANEL', 'TABLET', 'SYSTEM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Her tip TEK bir geçiştir — helper'daki `SWATCH_TRANSITIONS` ile boğaz-ikiz.
-- `IS NOT DISTINCT FROM`: NULL'lı karşılaştırma UNKNOWN döner ve CHECK UNKNOWN'ı geçirir.
DO $$ BEGIN
  ALTER TABLE "swatch_events" ADD CONSTRAINT "swatch_events_transition_known"
    CHECK (CASE "type"
      WHEN 'BORN'               THEN "fromStatus" IS NULL                              AND "toStatus" = 'IN_STOCK'
      WHEN 'VOIDED'             THEN "fromStatus" IS NOT DISTINCT FROM 'IN_STOCK'     AND "toStatus" = 'VOIDED'
      WHEN 'SACKED'             THEN "fromStatus" IS NOT DISTINCT FROM 'IN_STOCK'     AND "toStatus" = 'IN_SACK'
      WHEN 'UNSACKED'           THEN "fromStatus" IS NOT DISTINCT FROM 'IN_SACK'      AND "toStatus" = 'IN_STOCK'
      WHEN 'SHIPMENT_ADDED'     THEN "fromStatus" IS NOT DISTINCT FROM 'IN_SACK'      AND "toStatus" = 'IN_SHIPMENT'
      WHEN 'SHIPMENT_REMOVED'   THEN "fromStatus" IS NOT DISTINCT FROM 'IN_SHIPMENT'  AND "toStatus" = 'IN_SACK'
      WHEN 'SHIPPED'            THEN "fromStatus" IS NOT DISTINCT FROM 'IN_SHIPMENT'  AND "toStatus" = 'SHIPPED'
      WHEN 'SHIP_UNDONE'        THEN "fromStatus" IS NOT DISTINCT FROM 'SHIPPED'      AND "toStatus" = 'IN_SHIPMENT'
      WHEN 'REDUCED'            THEN "fromStatus" IS NOT DISTINCT FROM 'IN_STOCK'     AND "toStatus" = 'REDUCED'
      WHEN 'REDUCTION_REVERSED' THEN "fromStatus" IS NOT DISTINCT FROM 'REDUCED'      AND "toStatus" = 'IN_STOCK'
      ELSE false
    END);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Satır geçişin belgesini taşır: çuval olayı çuvalı, sevkiyat olayı sevkiyatı,
-- düşüm olayı düşüm belgesini, doğuş/iptal kabulü.
DO $$ BEGIN
  ALTER TABLE "swatch_events" ADD CONSTRAINT "swatch_events_ref_present"
    CHECK (CASE
      WHEN "type" IN ('SACKED', 'UNSACKED') THEN "sackId" IS NOT NULL
      WHEN "type" IN ('SHIPMENT_ADDED', 'SHIPMENT_REMOVED', 'SHIPPED', 'SHIP_UNDONE') THEN "shipmentId" IS NOT NULL
      WHEN "type" IN ('REDUCED', 'REDUCTION_REVERSED') THEN "reductionId" IS NOT NULL
      WHEN "type" IN ('BORN', 'VOIDED') THEN "receiptId" IS NOT NULL
      ELSE false
    END);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bağlı ters yalnız ters tiplerde: ileri satır bir şeyi terslemez.
DO $$ BEGIN
  ALTER TABLE "swatch_events" ADD CONSTRAINT "swatch_events_reversal_type"
    CHECK ("reversesEventId" IS NULL OR "type" IN ('VOIDED', 'SHIP_UNDONE', 'REDUCTION_REVERSED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only mühür: UPDATE her zaman, doğrudan DELETE reddedilir; kartelanın
-- kaskat silmesi (pg_trigger_depth() > 0) geçer.
DROP TRIGGER IF EXISTS "swatch_events_block_tamper" ON "swatch_events";
CREATE TRIGGER "swatch_events_block_tamper"
  BEFORE UPDATE OR DELETE ON "swatch_events"
  FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"();
