-- =============================================================================
-- İŞ ORTAĞI ROL MODELİ — Customer'a üç rol bayrağı + backfill (kullanıcı kararı 2026-09-17)
-- =============================================================================
-- YALNIZ EKLER: üç Boolean kolon (default false) + tek seferlik veri türetmesi. `type` KALIR
-- (türetilmiş, servis yazar); hiçbir kolon silinmez/adlanmaz. Backfill birebir:
--   type CUSTOMER → isCustomerRole · SUPPLIER → isSupplierRole · BOTH → ikisi;
--   fason profili bağlı kart (subcontractors.customerId) → isSubcontractorRole.
-- İdempotent: kolonlar IF NOT EXISTS; backfill yalnız HİÇ rolü olmayan satırlara dokunur
-- (ikinci koşumda 0 satır), fason bayrağı yalnız false olanlarda yazılır.
-- `migrate diff` çıktısındaki iki DEFERRABLE FK DROP satırı SİLİNDİ (reçete § migration 1. adım).
-- =============================================================================

-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isCustomerRole" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isSupplierRole" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isSubcontractorRole" BOOLEAN NOT NULL DEFAULT false;

-- Backfill ①: ticari yön `type`ten (yalnız hiç rolü olmayan satır)
UPDATE "customers"
   SET "isCustomerRole" = ("type" IN ('CUSTOMER', 'BOTH')),
       "isSupplierRole" = ("type" IN ('SUPPLIER', 'BOTH'))
 WHERE "isCustomerRole" = false AND "isSupplierRole" = false;

-- Backfill ②: fason rolü = bağlı fason profili
UPDATE "customers" c
   SET "isSubcontractorRole" = true
  FROM "subcontractors" s
 WHERE s."customerId" = c."id" AND c."isSubcontractorRole" = false;
