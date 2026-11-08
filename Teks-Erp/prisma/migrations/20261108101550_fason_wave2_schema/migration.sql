-- =============================================================================
-- Genel fason dalga-2 ŞEMA ÖNCÜSÜ (2026-11-08) — M2 (F4) + M3 (F5) + M4 (F6) + F9 tek dosyada.
-- Plan: ~/.tekserp/plan/PLAN-genel-fason.md §4, §5. Sözleşme: ~/.tekserp/plan/SOZLESME-fason-dalga2.md.
-- ADDITIVE: yeni iki tablo + yeni iki enum (CREATE TYPE) + nullable kolonlar + tek varsayılanlı NOT NULL kolon
-- (`subjectKind` DEFAULT 'ROLL' — PG 11+ katalog değişikliği, tablo yeniden yazılmaz). Toplu UPDATE/DELETE YOK.
-- Yeni kolonların hepsi NULL/ROLL okunur = bugünkü davranış. Tek yıkıcı görünen adım `service_billing_links`
-- `rollId` NOT NULL düşürmesi + aktif-bağ unique'inin AYNI ADLA yeniden kurulmasıdır: eski satırların hepsi
-- ROLL/warpBeamId NULL olduğundan yeni anahtar eskisiyle eşdeğerdir, mükerrere takılamaz.
-- Enum değerleri (WOUND, WOVEN, SHIPPED_TO_OWNER, CONSIGNMENT_OUT[_CANCEL]) 20261108101540..44'te (55P04).
-- Üretilen iki `DropForeignKey` satırı (rolls/swatches consistency FK) bilinçli silindi (reçete).
-- =============================================================================

-- ── yeni enum'lar (tip burada doğar) ─────────────────────────────────────────
DO $t$ BEGIN
  CREATE TYPE "ConsignmentItemKind" AS ENUM ('WARP_BEAM', 'YARN');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

DO $t$ BEGIN
  CREATE TYPE "ServiceBillingSubject" AS ENUM ('ROLL', 'WARP_BEAM');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

-- ── F4 (M2): hizmet bağı polimorfik özne ─────────────────────────────────────
ALTER TABLE "service_billing_links" ADD COLUMN IF NOT EXISTS "subjectKind" "ServiceBillingSubject" NOT NULL DEFAULT 'ROLL';
ALTER TABLE "service_billing_links" ADD COLUMN IF NOT EXISTS "warpBeamId" UUID;
ALTER TABLE "service_billing_links" ALTER COLUMN "rollId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "service_billing_links_warpBeamId_revokedAt_idx" ON "service_billing_links"("warpBeamId", "revokedAt");

DO $fk$ BEGIN
  ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_warpBeamId_fkey" FOREIGN KEY ("warpBeamId") REFERENCES "warp_beams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

ALTER TABLE "service_billing_links" DROP CONSTRAINT IF EXISTS "service_billing_links_subject_ck";
ALTER TABLE "service_billing_links" ADD CONSTRAINT "service_billing_links_subject_ck" CHECK (
  ("subjectKind" = 'ROLL' AND "rollId" IS NOT NULL AND "warpBeamId" IS NULL)
  OR ("subjectKind" = 'WARP_BEAM' AND "warpBeamId" IS NOT NULL AND "rollId" IS NULL)
);

-- İş başına tek aktif bağ: levent kolonu anahtara girer (yoksa iki leventin adımsız işi (NULL, kalem, NULL)
-- üçlüsünde çakışırdı). Ad AYNI kalır (test_db_invariants envanteri ve okuyucular değişmez).
DROP INDEX IF EXISTS "service_billing_links_active_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "service_billing_links_active_uq"
  ON "service_billing_links"("rollId", "warpBeamId", "serviceItemId", "workOrderStepId") NULLS NOT DISTINCT WHERE "revokedAt" IS NULL;

-- ── F5 (M3): emanet çıkış belgesi ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "consignment_dispatches" (
    "id" UUID NOT NULL,
    "dispatchNo" VARCHAR(64) NOT NULL,
    "clientToken" UUID,
    "ownerCustomerId" UUID NOT NULL,
    "dispatchedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedById" UUID,
    "plateNumber" VARCHAR(32),
    "driverName" VARCHAR(100),
    "notes" VARCHAR(500),
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "consignment_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "consignment_dispatch_items" (
    "id" UUID NOT NULL,
    "dispatchId" UUID NOT NULL,
    "kind" "ConsignmentItemKind" NOT NULL,
    "warpBeamId" UUID,
    "lengthM" DECIMAL(12,3),
    "yarnItemId" UUID,
    "warehouseId" UUID,
    "lotId" UUID,
    "qtyKg" DECIMAL(14,3),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignment_dispatch_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "consignment_dispatches_dispatchNo_key" ON "consignment_dispatches"("dispatchNo");
CREATE UNIQUE INDEX IF NOT EXISTS "consignment_dispatches_clientToken_key" ON "consignment_dispatches"("clientToken");
CREATE INDEX IF NOT EXISTS "consignment_dispatches_ownerCustomerId_dispatchedAt_idx" ON "consignment_dispatches"("ownerCustomerId", "dispatchedAt");
CREATE INDEX IF NOT EXISTS "consignment_dispatches_dispatchedAt_idx" ON "consignment_dispatches"("dispatchedAt");
CREATE INDEX IF NOT EXISTS "consignment_dispatch_items_warpBeamId_idx" ON "consignment_dispatch_items"("warpBeamId");
CREATE INDEX IF NOT EXISTS "consignment_dispatch_items_yarnItemId_idx" ON "consignment_dispatch_items"("yarnItemId");
CREATE INDEX IF NOT EXISTS "consignment_dispatch_items_warehouseId_idx" ON "consignment_dispatch_items"("warehouseId");
CREATE INDEX IF NOT EXISTS "consignment_dispatch_items_lotId_idx" ON "consignment_dispatch_items"("lotId");
CREATE UNIQUE INDEX IF NOT EXISTS "consignment_dispatch_items_dispatchId_warpBeamId_key" ON "consignment_dispatch_items"("dispatchId", "warpBeamId");

DO $fk$ BEGIN
  ALTER TABLE "consignment_dispatches" ADD CONSTRAINT "consignment_dispatches_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
  ALTER TABLE "consignment_dispatch_items" ADD CONSTRAINT "consignment_dispatch_items_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "consignment_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
  ALTER TABLE "consignment_dispatch_items" ADD CONSTRAINT "consignment_dispatch_items_warpBeamId_fkey" FOREIGN KEY ("warpBeamId") REFERENCES "warp_beams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
  ALTER TABLE "consignment_dispatch_items" ADD CONSTRAINT "consignment_dispatch_items_yarnItemId_fkey" FOREIGN KEY ("yarnItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
  ALTER TABLE "consignment_dispatch_items" ADD CONSTRAINT "consignment_dispatch_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
  ALTER TABLE "consignment_dispatch_items" ADD CONSTRAINT "consignment_dispatch_items_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "yarn_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

ALTER TABLE "consignment_dispatches" DROP CONSTRAINT IF EXISTS "consignment_dispatches_cancel_ck";
ALTER TABLE "consignment_dispatches" ADD CONSTRAINT "consignment_dispatches_cancel_ck" CHECK (("cancelledAt" IS NULL) = ("cancelReason" IS NULL));

ALTER TABLE "consignment_dispatch_items" DROP CONSTRAINT IF EXISTS "consignment_dispatch_items_kind_ref_ck";
ALTER TABLE "consignment_dispatch_items" ADD CONSTRAINT "consignment_dispatch_items_kind_ref_ck" CHECK (
  ("kind" = 'WARP_BEAM' AND "warpBeamId" IS NOT NULL AND "lengthM" IS NOT NULL
     AND "yarnItemId" IS NULL AND "warehouseId" IS NULL AND "lotId" IS NULL AND "qtyKg" IS NULL)
  OR ("kind" = 'YARN' AND "yarnItemId" IS NOT NULL AND "warehouseId" IS NOT NULL AND "qtyKg" IS NOT NULL
     AND "warpBeamId" IS NULL AND "lengthM" IS NULL)
);
ALTER TABLE "consignment_dispatch_items" DROP CONSTRAINT IF EXISTS "consignment_dispatch_items_qty_ck";
ALTER TABLE "consignment_dispatch_items" ADD CONSTRAINT "consignment_dispatch_items_qty_ck" CHECK (
  ("lengthM" IS NULL OR "lengthM" > 0) AND ("qtyKg" IS NULL OR "qtyKg" > 0)
);

-- Levent defteri: SHIP_TO_OWNER çifti (tür listesi `WARP_BEAM_EVENT_KINDS` ile iki yönlü).
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "consignmentItemId" UUID;
CREATE INDEX IF NOT EXISTS "warp_beam_events_consignmentItemId_idx" ON "warp_beam_events"("consignmentItemId");
DO $fk$ BEGIN
  ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_consignmentItemId_fkey" FOREIGN KEY ("consignmentItemId") REFERENCES "consignment_dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

ALTER TABLE "warp_beam_events" DROP CONSTRAINT IF EXISTS "warp_beam_events_kind_ck";
ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_kind_ck" CHECK ("kind" IN (
  'WOUND', 'WOUND_CANCEL', 'SHIP_OUT', 'SHIP_OUT_CANCEL', 'RETURNED_IN', 'RETURNED_IN_CANCEL',
  'MOUNTED', 'MOUNT_CANCEL', 'DISMOUNTED', 'DISMOUNT_CANCEL', 'CONSUMED', 'CONSUMED_CANCEL',
  'ADJUST_IN', 'ADJUST_OUT', 'EXHAUSTED', 'EXHAUST_CANCEL', 'SCRAPPED', 'SCRAP_CANCEL',
  'SHIP_TO_OWNER', 'SHIP_TO_OWNER_CANCEL'
));
ALTER TABLE "warp_beam_events" DROP CONSTRAINT IF EXISTS "warp_beam_events_consignment_item_ck";
ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_consignment_item_ck" CHECK (
  ("kind" IN ('SHIP_TO_OWNER', 'SHIP_TO_OWNER_CANCEL')) = ("consignmentItemId" IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS "warp_beam_events_ship_to_owner_item_uq" ON "warp_beam_events"("consignmentItemId") WHERE "kind" = 'SHIP_TO_OWNER';

-- İplik defteri: CONSIGNMENT_OUT çifti.
ALTER TABLE "yarn_movements" ADD COLUMN IF NOT EXISTS "consignmentItemId" UUID;
CREATE INDEX IF NOT EXISTS "yarn_movements_consignmentItemId_idx" ON "yarn_movements"("consignmentItemId");
DO $fk$ BEGIN
  ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_consignmentItemId_fkey" FOREIGN KEY ("consignmentItemId") REFERENCES "consignment_dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
ALTER TABLE "yarn_movements" DROP CONSTRAINT IF EXISTS "yarn_movements_consignment_link_ck";
ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_consignment_link_ck" CHECK (
  ("kind" IN ('CONSIGNMENT_OUT', 'CONSIGNMENT_OUT_CANCEL')) = ("consignmentItemId" IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS "yarn_movements_consignment_out_uq" ON "yarn_movements"("consignmentItemId") WHERE "kind" = 'CONSIGNMENT_OUT';

-- ── F6 (M4): giden fason ticari kapanış ──────────────────────────────────────
ALTER TABLE "subcontractor_dispatches" ADD COLUMN IF NOT EXISTS "expectedReturnAt" TIMESTAMPTZ;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "expectedReturnDays" INTEGER;
ALTER TABLE "subcontractor_categories" ADD COLUMN IF NOT EXISTS "expectedReturnDays" INTEGER;
ALTER TABLE "subcontractors" DROP CONSTRAINT IF EXISTS "subcontractors_expected_return_days_ck";
ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_expected_return_days_ck" CHECK ("expectedReturnDays" IS NULL OR "expectedReturnDays" BETWEEN 1 AND 365);
ALTER TABLE "subcontractor_categories" DROP CONSTRAINT IF EXISTS "subcontractor_categories_expected_return_days_ck";
ALTER TABLE "subcontractor_categories" ADD CONSTRAINT "subcontractor_categories_expected_return_days_ck" CHECK ("expectedReturnDays" IS NULL OR "expectedReturnDays" BETWEEN 1 AND 365);

ALTER TABLE "finishing_rates" ADD COLUMN IF NOT EXISTS "serviceItemId" UUID;
CREATE INDEX IF NOT EXISTS "finishing_rates_serviceItemId_idx" ON "finishing_rates"("serviceItemId");
DO $fk$ BEGIN
  ALTER TABLE "finishing_rates" ADD CONSTRAINT "finishing_rates_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

-- ── F9: yeniden işlem sınıfı (NULL = sınıfsız = ücretli, bugünkü) ─────────────
ALTER TABLE "reason_presets" ADD COLUMN IF NOT EXISTS "billable" BOOLEAN;
ALTER TABLE "reason_presets" DROP CONSTRAINT IF EXISTS "reason_presets_billable_ck";
ALTER TABLE "reason_presets" ADD CONSTRAINT "reason_presets_billable_ck" CHECK ("billable" IS NULL OR "kind" = 'WORK_ORDER_REWORK');
