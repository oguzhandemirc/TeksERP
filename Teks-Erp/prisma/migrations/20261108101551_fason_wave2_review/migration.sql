-- =============================================================================
-- Genel fason dalga-2 şema öncüsü — İNCELEME DÜZELTMESİ (2026-11-08). Sözleşme sürüm 2.
-- ADDITIVE: yeni iki tablo (20261108101550) henüz BOŞ (yazıcıları F5'te doğar) — sıkılaşan CHECK'ler hiçbir
-- satırı reddedemez. Tek yeni kolon nullable (NULL = bugünkü). Toplu UPDATE/DELETE YOK. İdempotent.
--   1) consignment_dispatches_cancel_ck: iptal ÜÇLÜSÜ (cancelledAt/cancelledById/cancelReason) birlikte dolar.
--   2) consignment_dispatch_items_kind_ref_ck: YARN kaleminde lotId ZORUNLU (sahip ve bakiye lot düzeyinde).
--   3) work_orders.reworkBillable: F9 yeniden işlem sınıfı İE yaratılırken donar; fatura canlı katalogu okumaz.
-- =============================================================================

ALTER TABLE "consignment_dispatches" DROP CONSTRAINT IF EXISTS "consignment_dispatches_cancel_ck";
ALTER TABLE "consignment_dispatches" ADD CONSTRAINT "consignment_dispatches_cancel_ck" CHECK (
  ("cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL)
  OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND "cancelReason" IS NOT NULL)
);

ALTER TABLE "consignment_dispatch_items" DROP CONSTRAINT IF EXISTS "consignment_dispatch_items_kind_ref_ck";
ALTER TABLE "consignment_dispatch_items" ADD CONSTRAINT "consignment_dispatch_items_kind_ref_ck" CHECK (
  ("kind" = 'WARP_BEAM' AND "warpBeamId" IS NOT NULL AND "lengthM" IS NOT NULL
     AND "yarnItemId" IS NULL AND "warehouseId" IS NULL AND "lotId" IS NULL AND "qtyKg" IS NULL)
  OR ("kind" = 'YARN' AND "yarnItemId" IS NOT NULL AND "warehouseId" IS NOT NULL AND "lotId" IS NOT NULL AND "qtyKg" IS NOT NULL
     AND "warpBeamId" IS NULL AND "lengthM" IS NULL)
);

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "reworkBillable" BOOLEAN;
