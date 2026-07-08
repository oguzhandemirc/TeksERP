-- Faz 4 — DB-seviyesi son savunma hattı (veritabani mimari denetimi bulgulari)
-- Bulgular: O-5 (CHECK), O-7 (Sack.manualCode partial unique), D-12 (WOStep unique),
--          D-10 (muhasebe FK Cascade->Restrict), O-22 (Roll/Swatch<->Sack<->Shipment).
--
-- statement_timeout=0 (CLAUDE.md kural 14): dolu uretim DB'sinde uzun DDL 50s'de
-- iptal olmasin. CHECK'ler NOT VALID + ayri VALIDATE ile eklenir: ADD an anda tabloyu
-- taramaz (kilit kisa), VALIDATE ise ACCESS EXCLUSIVE degil daha hafif kilitle dogrular.
SET statement_timeout = 0;

-- ============================================================================
-- O-5: CHECK constraint'ler — negatif miktar/kg ve mantiksiz tarih sirasi
-- ============================================================================
ALTER TABLE "rolls"                ADD CONSTRAINT "rolls_currentQty_nonneg"          CHECK ("currentQty" >= 0) NOT VALID;
ALTER TABLE "rolls"                ADD CONSTRAINT "rolls_initialQty_nonneg"          CHECK ("initialQty" >= 0) NOT VALID;
ALTER TABLE "rolls"                ADD CONSTRAINT "rolls_weightKg_nonneg"            CHECK ("weightKg" IS NULL OR "weightKg" >= 0) NOT VALID;
ALTER TABLE "order_lines"          ADD CONSTRAINT "order_lines_quantity_pos"         CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "order_lines"          ADD CONSTRAINT "order_lines_shippedQty_nonneg"    CHECK ("shippedQty" >= 0) NOT VALID;
ALTER TABLE "shipment_allocations" ADD CONSTRAINT "shipment_allocations_qty_pos"     CHECK ("qty" > 0) NOT VALID;
ALTER TABLE "sacks"                ADD CONSTRAINT "sacks_weightKg_nonneg"            CHECK ("weightKg" IS NULL OR "weightKg" >= 0) NOT VALID;
ALTER TABLE "work_order_steps"     ADD CONSTRAINT "work_order_steps_time_order"      CHECK ("completedAt" IS NULL OR "startedAt" IS NULL OR "completedAt" >= "startedAt") NOT VALID;

ALTER TABLE "rolls"                VALIDATE CONSTRAINT "rolls_currentQty_nonneg";
ALTER TABLE "rolls"                VALIDATE CONSTRAINT "rolls_initialQty_nonneg";
ALTER TABLE "rolls"                VALIDATE CONSTRAINT "rolls_weightKg_nonneg";
ALTER TABLE "order_lines"          VALIDATE CONSTRAINT "order_lines_quantity_pos";
ALTER TABLE "order_lines"          VALIDATE CONSTRAINT "order_lines_shippedQty_nonneg";
ALTER TABLE "shipment_allocations" VALIDATE CONSTRAINT "shipment_allocations_qty_pos";
ALTER TABLE "sacks"                VALIDATE CONSTRAINT "sacks_weightKg_nonneg";
ALTER TABLE "work_order_steps"     VALIDATE CONSTRAINT "work_order_steps_time_order";

-- ============================================================================
-- D-12: WorkOrderStep(workOrderId, stepSequence) benzersiz — ayni WO'da iki adim
-- ayni siraya sahip olamaz. Mevcut tam index unique'e yukseltilir (Prisma _key adi).
-- ============================================================================
DROP INDEX "work_order_steps_workOrderId_stepSequence_idx";
CREATE UNIQUE INDEX "work_order_steps_workOrderId_stepSequence_key" ON "work_order_steps" ("workOrderId", "stepSequence");

-- ============================================================================
-- O-7: Sack.manualCode SEVKIYAT-ICI benzersiz (partial unique). Mevcut AMB%05d
-- global partial'i (sacks_manualCode_idx) ile cakismaz. Semada @@index olarak durur;
-- CLAUDE.md kural 4 drift-free deseni (Prisma 7 partial predicate'i drift saymaz).
-- ============================================================================
-- İsim @@index([shipmentId, manualCode])'in Prisma karşılığı (_idx) ile eşleşir ki
-- drift-free desen çalışsın; UNIQUE + partial modifier'ları Prisma 7 drift saymaz.
CREATE UNIQUE INDEX "sacks_shipmentId_manualCode_idx" ON "sacks" ("shipmentId", "manualCode") WHERE "manualCode" IS NOT NULL;

-- ============================================================================
-- D-10: Muhasebe defteri FK'lari Cascade -> Restrict. Shipment fiziksel silinirse
-- allocation/order defteri SESSIZCE yok olup shippedQty'yi bozmasin. App shipment'i
-- hard-delete etmez (kendi silmelerini tx icinde acikca yapar) -> davranis degismez;
-- yalniz elle 'DELETE FROM shipments' gibi bakim mudahalesini bloklar.
-- ============================================================================
ALTER TABLE "shipment_allocations" DROP CONSTRAINT "shipment_allocations_shipmentId_fkey";
ALTER TABLE "shipment_allocations" ADD  CONSTRAINT "shipment_allocations_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shipment_orders" DROP CONSTRAINT "shipment_orders_shipmentId_fkey";
ALTER TABLE "shipment_orders" ADD  CONSTRAINT "shipment_orders_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- O-22: Roll/Swatch <-> Sack <-> Shipment tutarlilik invariant'i (DB seddi).
-- Bir topun/kartelanin sackId'si varsa, shipmentId'si o cuvalin shipmentId'siyle
-- AYNI olmali (yoksa irsaliye/ceki listesi yanlis musteri icerigi basar).
--
-- Tasarim: mevcut tekil sackId FK (ON DELETE SET NULL) KORUNUR; ustune composite
-- FK eklenir. Composite FK icin sacks(id, shipmentId) UNIQUE hedefi gerekir.
--   * MATCH SIMPLE: ikisi de dolu olunca zorlar (biri NULL ise atlanir) — dogal.
--   * DEFERRABLE INITIALLY DEFERRED: kontrol COMMIT'te yapilir; app scan-in'de
--     sackId/shipmentId'yi cok adimda set etse bile yalniz commit'teki son durum
--     tutarli olmali (tek-statement kirilmasi riski yok).
--   * ON DELETE NO ACTION: bos cuval disinda cuval silinmez; silinirse tekil FK
--     zaten sackId'yi NULL yapar, composite (NULL) commit'te tatmin olur.
--   * ON UPDATE CASCADE: cuval baska sevkiyata tasinirsa iceriginin shipmentId'si
--     otomatik takip eder (invariant app degisikligi olmadan korunur).
-- ============================================================================
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_id_shipmentId_key" UNIQUE ("id", "shipmentId");

ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sackId_shipmentId_consistency_fkey"
  FOREIGN KEY ("sackId", "shipmentId") REFERENCES "sacks"("id", "shipmentId")
  ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "swatches" ADD CONSTRAINT "swatches_sackId_shipmentId_consistency_fkey"
  FOREIGN KEY ("sackId", "shipmentId") REFERENCES "sacks"("id", "shipmentId")
  ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
