-- 2026-07-31 veri butunlugu denetimi (A6 + G-9) — eksik CHECK seddleri.
-- Rapor: docs/audit/VERI-BUTUNLUGU-RAPORU-2026-07-31.md Bolum C-D tablosu.
-- Desen: faz4 (20260708120000) ile birebir — NOT VALID (kisa kilit) + VALIDATE
-- (hafif kilit). Envanter bekcisi: scripts/test_db_invariants.ts CHECK_CONSTRAINTS
-- listesi AYNI degisiklikte genisletildi.
--
-- !! DEPLOY ON-KOSULU (uretim): VALIDATE, ihlal eden eski satir varsa DUSER.
-- Deploy'dan once uretim kopyasinda on-tarama kosulmali (asagidaki kurallarin
-- SELECT karsiliklari: scripts/consistency-check.sql + rapor Bolum E on-taramasi;
-- dev'de 18/18 sifir ihlal dogrulandi 2026-07-31). Ihlal cikarsa once veri karari.
--
-- statement_timeout=0 (CLAUDE.md kural 14): dolu uretim DB'sinde VALIDATE tablo
-- taramasi 50s sinirina takilmasin.
SET statement_timeout = 0;

-- ============================================================================
-- RollMovement — istasyon muhasebesi (Roll.currentQty'nin kaynak defteri;
-- rolls tarafinin CHECK'i faz4'te vardi, onu besleyen movement'inki yoktu)
-- ============================================================================
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_qtyIn_nonneg"     CHECK ("qtyIn" >= 0) NOT VALID;
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_qtyOut_nonneg"    CHECK ("qtyOut" IS NULL OR "qtyOut" >= 0) NOT VALID;
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_weightIn_nonneg"  CHECK ("weightIn" IS NULL OR "weightIn" >= 0) NOT VALID;
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_weightOut_nonneg" CHECK ("weightOut" IS NULL OR "weightOut" >= 0) NOT VALID;
ALTER TABLE "roll_errors"    ADD CONSTRAINT "roll_errors_startMeter_nonneg"   CHECK ("startMeter" >= 0) NOT VALID;

-- ============================================================================
-- Sevk / tahsis defterleri — OrderLine.shippedQty'nin TEK yazma kaynagi
-- sack_allocations'tir; kendisi CHECK'sizdi (faz4'un shipment_allocations_qty_pos'u
-- cuval modeli gecisinde tabloyla birlikte oldu, yenisine tasinmamisti).
-- ============================================================================
ALTER TABLE "sack_allocations"                      ADD CONSTRAINT "sack_allocations_qty_pos"                          CHECK ("qty" > 0) NOT VALID;
ALTER TABLE "subcontractor_direct_ship_allocations" ADD CONSTRAINT "subcontractor_direct_ship_allocations_qty_pos"     CHECK ("qty" > 0) NOT VALID;
ALTER TABLE "work_order_to_order_lines"             ADD CONSTRAINT "work_order_to_order_lines_allocatedQty_nonneg"     CHECK ("allocatedQty" >= 0) NOT VALID;

-- ============================================================================
-- Fason / kartela sevk-kabul kalemleri + dogrudan sevk olayi
-- ============================================================================
ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_dispatchedQty_pos"      CHECK ("dispatchedQty" > 0) NOT VALID;
ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_dispatchedWeight_nonneg" CHECK ("dispatchedWeight" IS NULL OR "dispatchedWeight" >= 0) NOT VALID;
ALTER TABLE "kartela_dispatch_items"       ADD CONSTRAINT "kartela_dispatch_items_dispatchedQty_pos"            CHECK ("dispatchedQty" > 0) NOT VALID;
ALTER TABLE "kartela_dispatch_items"       ADD CONSTRAINT "kartela_dispatch_items_dispatchedWeight_nonneg"      CHECK ("dispatchedWeight" IS NULL OR "dispatchedWeight" >= 0) NOT VALID;
ALTER TABLE "kartela_receipt_items"        ADD CONSTRAINT "kartela_receipt_items_kartelaCount_pos"              CHECK ("kartelaCount" > 0) NOT VALID;
ALTER TABLE "swatch_stock_reductions"      ADD CONSTRAINT "swatch_stock_reductions_count_pos"                   CHECK ("count" > 0) NOT VALID;
ALTER TABLE "direct_shipments"             ADD CONSTRAINT "direct_shipments_totalQty_pos"                       CHECK ("totalQty" > 0) NOT VALID;
ALTER TABLE "direct_shipments"             ADD CONSTRAINT "direct_shipments_rollCount_pos"                      CHECK ("rollCount" > 0) NOT VALID;

-- ============================================================================
-- Iade defteri + WO kosullu zorunluluk (G-9): STOCK_PRODUCTION'da targetItemId
-- zorunlulugu 3 ayri call-site'ta elle tekrarlaniyordu — DB seddi yoktu.
-- ============================================================================
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_qty_pos" CHECK ("qty" > 0) NOT VALID;
ALTER TABLE "work_orders"  ADD CONSTRAINT "work_orders_stockprod_targetItem"
  CHECK ("type" <> 'STOCK_PRODUCTION' OR "targetItemId" IS NOT NULL) NOT VALID;

-- ============================================================================
-- VALIDATE — eski satirlari da dogrular (validate edilmemis CHECK yeni satiri
-- korur ama eskiyi korumaz; test_db_invariants convalidated'i da denetler).
-- ============================================================================
ALTER TABLE "roll_movements"                        VALIDATE CONSTRAINT "roll_movements_qtyIn_nonneg";
ALTER TABLE "roll_movements"                        VALIDATE CONSTRAINT "roll_movements_qtyOut_nonneg";
ALTER TABLE "roll_movements"                        VALIDATE CONSTRAINT "roll_movements_weightIn_nonneg";
ALTER TABLE "roll_movements"                        VALIDATE CONSTRAINT "roll_movements_weightOut_nonneg";
ALTER TABLE "roll_errors"                           VALIDATE CONSTRAINT "roll_errors_startMeter_nonneg";
ALTER TABLE "sack_allocations"                      VALIDATE CONSTRAINT "sack_allocations_qty_pos";
ALTER TABLE "subcontractor_direct_ship_allocations" VALIDATE CONSTRAINT "subcontractor_direct_ship_allocations_qty_pos";
ALTER TABLE "work_order_to_order_lines"             VALIDATE CONSTRAINT "work_order_to_order_lines_allocatedQty_nonneg";
ALTER TABLE "subcontractor_dispatch_items"          VALIDATE CONSTRAINT "subcontractor_dispatch_items_dispatchedQty_pos";
ALTER TABLE "subcontractor_dispatch_items"          VALIDATE CONSTRAINT "subcontractor_dispatch_items_dispatchedWeight_nonneg";
ALTER TABLE "kartela_dispatch_items"                VALIDATE CONSTRAINT "kartela_dispatch_items_dispatchedQty_pos";
ALTER TABLE "kartela_dispatch_items"                VALIDATE CONSTRAINT "kartela_dispatch_items_dispatchedWeight_nonneg";
ALTER TABLE "kartela_receipt_items"                 VALIDATE CONSTRAINT "kartela_receipt_items_kartelaCount_pos";
ALTER TABLE "swatch_stock_reductions"               VALIDATE CONSTRAINT "swatch_stock_reductions_count_pos";
ALTER TABLE "direct_shipments"                      VALIDATE CONSTRAINT "direct_shipments_totalQty_pos";
ALTER TABLE "direct_shipments"                      VALIDATE CONSTRAINT "direct_shipments_rollCount_pos";
ALTER TABLE "roll_returns"                          VALIDATE CONSTRAINT "roll_returns_qty_pos";
ALTER TABLE "work_orders"                           VALIDATE CONSTRAINT "work_orders_stockprod_targetItem";
